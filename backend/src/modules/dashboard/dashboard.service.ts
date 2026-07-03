import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** Executive dashboard aggregates. One endpoint, one round trip for the whole page. */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const [
      wonAll, wonThisMonth, quoteCounts, pendingQuotes,
      activeJobs, completedJobs, monthly, topCustomers, topVendors,
      revenueByService, revenueBySales,
    ] = await Promise.all([
      this.prisma.quotation.aggregate({ where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true } }),
      this.prisma.quotation.aggregate({ where: { status: 'WON', quoteDate: { gte: monthStart } }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true } }),
      this.prisma.quotation.groupBy({ by: ['status'], _count: true, _sum: { sellingPrice: true } }),
      this.prisma.quotation.count({ where: { status: { in: ['DRAFT', 'SENT'] } } }),
      this.prisma.job.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.job.count({ where: { status: 'COMPLETED' } }),
      this.monthlyTrend(12),
      this.topCustomers(5),
      this.topVendors(5),
      this.revenueByService(),
      this.revenueBySalesPerson(),
    ]);

    const countOf = (s: string) => quoteCounts.find((c) => c.status === s)?._count ?? 0;
    const won = countOf('WON');
    const lost = countOf('LOST');
    const decided = won + lost;
    const totalRevenue = Number(wonAll._sum.sellingPrice ?? 0) - Number(wonAll._sum.taxAmt ?? 0);
    const totalGp = Number(wonAll._sum.grossProfit ?? 0);
    const quotationValue = quoteCounts.reduce((s, c) => s + Number(c._sum.sellingPrice ?? 0), 0);

    return {
      revenue: r2(totalRevenue),
      grossProfit: r2(totalGp),
      profitMarginPct: totalRevenue > 0 ? r2((totalGp / totalRevenue) * 100) : 0,
      monthRevenue: r2(Number(wonThisMonth._sum.sellingPrice ?? 0) - Number(wonThisMonth._sum.taxAmt ?? 0)),
      monthGrossProfit: r2(Number(wonThisMonth._sum.grossProfit ?? 0)),
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

  /** Revenue + GP per month for the last N months (WON quotes). */
  private async monthlyTrend(months: number) {
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1), 1);
    start.setHours(0, 0, 0, 0);
    const quotes = await this.prisma.quotation.findMany({
      where: { status: 'WON', quoteDate: { gte: start } },
      select: { quoteDate: true, sellingPrice: true, grossProfit: true, taxAmt: true },
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
        bucket.revenue += Number(q.sellingPrice) - Number(q.taxAmt);
        bucket.grossProfit += Number(q.grossProfit);
      }
    }
    return out.map((o) => ({ ...o, revenue: Math.round(o.revenue * 100) / 100, grossProfit: Math.round(o.grossProfit * 100) / 100 }));
  }

  /** Top customers by revenue with profitability. */
  private async topCustomers(take: number) {
    const grouped = await this.prisma.quotation.groupBy({
      by: ['customerId'], where: { status: 'WON' },
      _sum: { sellingPrice: true, grossProfit: true, taxAmt: true }, _count: true,
    });
    const sorted = grouped
      .map((g) => ({
        customerId: g.customerId,
        revenue: Number(g._sum.sellingPrice ?? 0) - Number(g._sum.taxAmt ?? 0),
        grossProfit: Number(g._sum.grossProfit ?? 0),
        quotations: g._count,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, take);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: sorted.map((s) => s.customerId) } }, select: { id: true, companyName: true, code: true } });
    const nameMap = new Map(customers.map((c) => [c.id, c]));
    return sorted.map((s) => ({ ...s, name: nameMap.get(s.customerId)?.companyName ?? '?', code: nameMap.get(s.customerId)?.code }));
  }

  /** Top vendors by spend (vendor spending panel). */
  private async topVendors(take: number) {
    const grouped = await this.prisma.quotationItem.groupBy({
      by: ['vendorId'], where: { vendorId: { not: null }, quotation: { status: 'WON' } },
      _sum: { totalCost: true }, _count: true,
    });
    const sorted = grouped
      .map((g) => ({ vendorId: g.vendorId as string, spend: Number(g._sum.totalCost ?? 0), items: g._count }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, take);
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: sorted.map((s) => s.vendorId) } }, select: { id: true, name: true, code: true, isPreferred: true } });
    const map = new Map(vendors.map((v) => [v.id, v]));
    return sorted.map((s) => ({ ...s, name: map.get(s.vendorId)?.name ?? '?', code: map.get(s.vendorId)?.code, isPreferred: map.get(s.vendorId)?.isPreferred ?? false }));
  }

  private async revenueByService() {
    const grouped = await this.prisma.quotationItem.groupBy({
      by: ['serviceId'], where: { quotation: { status: 'WON' } }, _sum: { totalSell: true, grossProfit: true },
    });
    const services = await this.prisma.service.findMany({ where: { id: { in: grouped.map((g) => g.serviceId) } }, select: { id: true, name: true } });
    const map = new Map(services.map((s) => [s.id, s.name]));
    return grouped
      .map((g) => ({ service: map.get(g.serviceId) ?? '?', revenue: Number(g._sum.totalSell ?? 0), grossProfit: Number(g._sum.grossProfit ?? 0) }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  private async revenueBySalesPerson() {
    const grouped = await this.prisma.quotation.groupBy({
      by: ['salesPersonId'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true }, _count: true,
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.salesPersonId).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    const map = new Map(users.map((u) => [u.id, u.fullName]));
    return grouped
      .map((g) => ({
        salesPerson: g.salesPersonId ? map.get(g.salesPersonId) ?? '?' : '(Unassigned)',
        revenue: Number(g._sum.sellingPrice ?? 0) - Number(g._sum.taxAmt ?? 0),
        grossProfit: Number(g._sum.grossProfit ?? 0),
        quotations: g._count,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }
}
