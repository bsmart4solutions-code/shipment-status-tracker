import { Injectable } from '@nestjs/common';
import { FxConverter, FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';

/**
 * Executive dashboard aggregates. One endpoint, one round trip for the whole page.
 *
 * Every money SUM here crosses documents that each carry their own currency,
 * so aggregation always groups by currency first and converts to the base
 * currency (FxService) before merging — never add MYR to USD raw.
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private fx: FxService) {}

  async summary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const fx = await this.fx.converter();

    const [
      wonAll, wonThisMonth, quoteCounts, pendingQuotes,
      activeJobs, completedJobs, monthly, topCustomers, topVendors,
      revenueByService, revenueBySales,
    ] = await Promise.all([
      this.prisma.quotation.groupBy({ by: ['currency'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true } }),
      this.prisma.quotation.groupBy({ by: ['currency'], where: { status: 'WON', quoteDate: { gte: monthStart } }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true } }),
      this.prisma.quotation.groupBy({ by: ['status', 'currency'], _count: true, _sum: { sellingPrice: true } }),
      this.prisma.quotation.count({ where: { status: { in: ['DRAFT', 'SENT'] } } }),
      this.prisma.job.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.job.count({ where: { status: 'COMPLETED' } }),
      this.monthlyTrend(12, fx),
      this.topCustomers(5, fx),
      this.topVendors(5, fx),
      this.revenueByService(fx),
      this.revenueBySalesPerson(fx),
    ]);

    // Net revenue (sell − tax) and GP, converted per currency group then summed.
    const sumConverted = (groups: typeof wonAll) =>
      groups.reduce(
        (acc, g) => ({
          revenue: acc.revenue + fx.toBase(Number(g._sum.sellingPrice ?? 0) - Number(g._sum.taxAmt ?? 0), g.currency),
          gp: acc.gp + fx.toBase(Number(g._sum.grossProfit ?? 0), g.currency),
        }),
        { revenue: 0, gp: 0 },
      );
    const all = sumConverted(wonAll);
    const month = sumConverted(wonThisMonth);

    const countOf = (s: string) => quoteCounts.filter((c) => c.status === s).reduce((n, c) => n + c._count, 0);
    const won = countOf('WON');
    const lost = countOf('LOST');
    const decided = won + lost;
    const quotationValue = quoteCounts.reduce((s, c) => s + fx.toBase(Number(c._sum.sellingPrice ?? 0), c.currency), 0);

    return {
      baseCurrency: fx.baseCurrency,
      fxWarning: this.fx.warning(fx),
      revenue: r2(all.revenue),
      grossProfit: r2(all.gp),
      profitMarginPct: all.revenue > 0 ? r2((all.gp / all.revenue) * 100) : 0,
      monthRevenue: r2(month.revenue),
      monthGrossProfit: r2(month.gp),
      quotationValue: r2(quotationValue),
      quotationWinRatePct: decided > 0 ? r2((won / decided) * 100) : 0,
      counts: {
        pendingQuotations: pendingQuotes,
        wonQuotations: won,
        lostQuotations: lost,
        activeJobs,
        completedJobs,
      },
      monthlyTrend: monthly,
      topCustomers,
      topVendors,
      revenueByService,
      revenueBySalesPerson: revenueBySales,
      yearStart,
    };
  }

  /** Revenue + GP per month for the last N months (WON quotes), in base currency. */
  private async monthlyTrend(months: number, fx: FxConverter) {
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1), 1);
    start.setHours(0, 0, 0, 0);
    const quotes = await this.prisma.quotation.findMany({
      where: { status: 'WON', quoteDate: { gte: start } },
      select: { quoteDate: true, sellingPrice: true, grossProfit: true, taxAmt: true, currency: true },
    });
    const out: { month: string; revenue: number; grossProfit: number }[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      out.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, revenue: 0, grossProfit: 0 });
    }
    const map = new Map(out.map((o) => [o.month, o]));
    for (const q of quotes) {
      const key = `${q.quoteDate.getFullYear()}-${String(q.quoteDate.getMonth() + 1).padStart(2, '0')}`;
      const bucket = map.get(key);
      if (bucket) {
        bucket.revenue += fx.toBase(Number(q.sellingPrice) - Number(q.taxAmt), q.currency);
        bucket.grossProfit += fx.toBase(Number(q.grossProfit), q.currency);
      }
    }
    return out.map((o) => ({ ...o, revenue: Math.round(o.revenue * 100) / 100, grossProfit: Math.round(o.grossProfit * 100) / 100 }));
  }

  /** Top customers by revenue with profitability, in base currency. */
  private async topCustomers(take: number, fx: FxConverter) {
    const grouped = await this.prisma.quotation.groupBy({
      by: ['customerId', 'currency'], where: { status: 'WON' },
      _sum: { sellingPrice: true, grossProfit: true, taxAmt: true }, _count: true,
    });
    const byCustomer = new Map<string, { revenue: number; grossProfit: number; quotations: number }>();
    for (const g of grouped) {
      const acc = byCustomer.get(g.customerId) ?? { revenue: 0, grossProfit: 0, quotations: 0 };
      acc.revenue += fx.toBase(Number(g._sum.sellingPrice ?? 0) - Number(g._sum.taxAmt ?? 0), g.currency);
      acc.grossProfit += fx.toBase(Number(g._sum.grossProfit ?? 0), g.currency);
      acc.quotations += g._count;
      byCustomer.set(g.customerId, acc);
    }
    const sorted = [...byCustomer.entries()]
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, take);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: sorted.map((s) => s.customerId) } }, select: { id: true, companyName: true, code: true } });
    const nameMap = new Map(customers.map((c) => [c.id, c]));
    return sorted.map((s) => ({ ...s, name: nameMap.get(s.customerId)?.companyName ?? '?', code: nameMap.get(s.customerId)?.code }));
  }

  /**
   * Top vendors by spend, in base currency. Item totals are stored in the
   * parent quotation's currency, which groupBy can't reach — so fetch rows
   * and aggregate here (WON-only keeps the set small).
   */
  private async topVendors(take: number, fx: FxConverter) {
    const items = await this.prisma.quotationItem.findMany({
      where: { vendorId: { not: null }, quotation: { status: 'WON' } },
      select: { vendorId: true, totalCost: true, quotation: { select: { currency: true } } },
    });
    const byVendor = new Map<string, { spend: number; items: number }>();
    for (const it of items) {
      const acc = byVendor.get(it.vendorId as string) ?? { spend: 0, items: 0 };
      acc.spend += fx.toBase(Number(it.totalCost), it.quotation.currency);
      acc.items += 1;
      byVendor.set(it.vendorId as string, acc);
    }
    const sorted = [...byVendor.entries()]
      .map(([vendorId, v]) => ({ vendorId, ...v }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, take);
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: sorted.map((s) => s.vendorId) } }, select: { id: true, name: true, code: true, isPreferred: true } });
    const map = new Map(vendors.map((v) => [v.id, v]));
    return sorted.map((s) => ({ ...s, name: map.get(s.vendorId)?.name ?? '?', code: map.get(s.vendorId)?.code, isPreferred: map.get(s.vendorId)?.isPreferred ?? false }));
  }

  private async revenueByService(fx: FxConverter) {
    const items = await this.prisma.quotationItem.findMany({
      where: { quotation: { status: 'WON' } },
      select: { serviceId: true, totalSell: true, grossProfit: true, quotation: { select: { currency: true } } },
    });
    const byService = new Map<string, { revenue: number; grossProfit: number }>();
    for (const it of items) {
      const acc = byService.get(it.serviceId) ?? { revenue: 0, grossProfit: 0 };
      acc.revenue += fx.toBase(Number(it.totalSell), it.quotation.currency);
      acc.grossProfit += fx.toBase(Number(it.grossProfit), it.quotation.currency);
      byService.set(it.serviceId, acc);
    }
    const services = await this.prisma.service.findMany({ where: { id: { in: [...byService.keys()] } }, select: { id: true, name: true } });
    const map = new Map(services.map((s) => [s.id, s.name]));
    return [...byService.entries()]
      .map(([serviceId, v]) => ({ service: map.get(serviceId) ?? '?', revenue: v.revenue, grossProfit: v.grossProfit }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  private async revenueBySalesPerson(fx: FxConverter) {
    const grouped = await this.prisma.quotation.groupBy({
      by: ['salesPersonId', 'currency'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true }, _count: true,
    });
    const bySales = new Map<string | null, { revenue: number; grossProfit: number; quotations: number }>();
    for (const g of grouped) {
      const acc = bySales.get(g.salesPersonId) ?? { revenue: 0, grossProfit: 0, quotations: 0 };
      acc.revenue += fx.toBase(Number(g._sum.sellingPrice ?? 0) - Number(g._sum.taxAmt ?? 0), g.currency);
      acc.grossProfit += fx.toBase(Number(g._sum.grossProfit ?? 0), g.currency);
      acc.quotations += g._count;
      bySales.set(g.salesPersonId, acc);
    }
    const ids = [...bySales.keys()].filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const map = new Map(users.map((u) => [u.id, u.fullName]));
    return [...bySales.entries()]
      .map(([salesPersonId, v]) => ({
        salesPerson: salesPersonId ? map.get(salesPersonId) ?? '?' : '(Unassigned)',
        ...v,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }
}
