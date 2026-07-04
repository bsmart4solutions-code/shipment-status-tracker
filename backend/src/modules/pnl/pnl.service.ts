import { Injectable } from '@nestjs/common';
import { FxConverter, FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';

export interface PnlFilter {
  from?: string;
  to?: string;
  groupBy?: 'month' | 'quarter' | 'year' | 'customer' | 'vendor' | 'salesperson' | 'service';
  customerId?: string;
  vendorId?: string;
  salesPersonId?: string;
  serviceId?: string;
  /** 'quotes' = won quotations (default) · 'jobs' = actuals from executed jobs */
  source?: 'quotes' | 'jobs';
}

/**
 * Profit & Loss built from WON quotations (commercial view) or job actuals
 * (execution view). Grouping happens in memory after a single filtered
 * fetch — datasets are per-period so this stays fast; can move to raw SQL
 * GROUP BY when volume demands.
 *
 * All amounts are converted to the base currency before bucketing —
 * documents carry their own currency and must never be summed raw.
 */
@Injectable()
export class PnlService {
  constructor(private prisma: PrismaService, private fx: FxService) {}

  async report(filter: PnlFilter) {
    const fx = await this.fx.converter();
    const result = filter.source === 'jobs' ? await this.fromJobs(filter, fx) : await this.fromQuotations(filter, fx);
    return { ...result, baseCurrency: fx.baseCurrency, fxWarning: this.fx.warning(fx) };
  }

  private periodKey(date: Date, groupBy: string): string {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    if (groupBy === 'year') return String(y);
    if (groupBy === 'quarter') return `${y}-Q${Math.ceil(m / 3)}`;
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  private async fromQuotations(filter: PnlFilter, fx: FxConverter) {
    const groupBy = filter.groupBy ?? 'month';
    // vendor/service grouping needs item granularity; the rest can use headers
    const itemLevel = groupBy === 'vendor' || groupBy === 'service' || filter.vendorId || filter.serviceId;

    const quoteWhere = {
      status: 'WON' as const,
      quoteDate: {
        gte: filter.from ? new Date(filter.from) : undefined,
        lte: filter.to ? new Date(filter.to) : undefined,
      },
      customerId: filter.customerId || undefined,
      salesPersonId: filter.salesPersonId || undefined,
    };

    if (!itemLevel) {
      const quotes = await this.prisma.quotation.findMany({
        where: quoteWhere,
        include: { customer: { select: { companyName: true } }, salesPerson: { select: { fullName: true } } },
      });
      const buckets = new Map<string, { revenue: number; cost: number; count: number }>();
      for (const q of quotes) {
        const key =
          groupBy === 'customer' ? q.customer.companyName :
          groupBy === 'salesperson' ? (q.salesPerson?.fullName ?? '(Unassigned)') :
          this.periodKey(q.quoteDate, groupBy);
        const b = buckets.get(key) ?? { revenue: 0, cost: 0, count: 0 };
        // revenue = net sell before tax (sellingPrice − taxAmt) for a true margin view
        b.revenue += fx.toBase(Number(q.sellingPrice) - Number(q.taxAmt), q.currency);
        b.cost += fx.toBase(Number(q.totalCost), q.currency);
        b.count += 1;
        buckets.set(key, b);
      }
      return this.toRows(buckets);
    }

    const items = await this.prisma.quotationItem.findMany({
      where: {
        quotation: quoteWhere,
        vendorId: filter.vendorId || undefined,
        serviceId: filter.serviceId || undefined,
      },
      include: {
        quotation: { select: { quoteDate: true, currency: true, customer: { select: { companyName: true } }, salesPerson: { select: { fullName: true } } } },
        vendor: { select: { name: true } },
        service: { select: { name: true } },
      },
    });
    const buckets = new Map<string, { revenue: number; cost: number; count: number }>();
    for (const i of items) {
      const key =
        groupBy === 'vendor' ? (i.vendor?.name ?? '(No vendor)') :
        groupBy === 'service' ? i.service.name :
        groupBy === 'customer' ? i.quotation.customer.companyName :
        groupBy === 'salesperson' ? (i.quotation.salesPerson?.fullName ?? '(Unassigned)') :
        this.periodKey(i.quotation.quoteDate, groupBy);
      const b = buckets.get(key) ?? { revenue: 0, cost: 0, count: 0 };
      b.revenue += fx.toBase(Number(i.totalSell), i.quotation.currency);
      b.cost += fx.toBase(Number(i.totalCost), i.quotation.currency);
      b.count += 1;
      buckets.set(key, b);
    }
    return this.toRows(buckets);
  }

  private async fromJobs(filter: PnlFilter, fx: FxConverter) {
    const groupBy = filter.groupBy ?? 'month';
    const jobs = await this.prisma.job.findMany({
      where: {
        status: { not: 'CANCELLED' },
        createdAt: {
          gte: filter.from ? new Date(filter.from) : undefined,
          lte: filter.to ? new Date(filter.to) : undefined,
        },
        customerId: filter.customerId || undefined,
        vendorId: filter.vendorId || undefined,
      },
      include: { customer: { select: { companyName: true } }, vendor: { select: { name: true } } },
    });
    const buckets = new Map<string, { revenue: number; cost: number; count: number }>();
    for (const j of jobs) {
      const date = j.shipmentDate ?? j.createdAt;
      const key =
        groupBy === 'customer' ? j.customer.companyName :
        groupBy === 'vendor' ? (j.vendor?.name ?? '(No vendor)') :
        this.periodKey(date, groupBy);
      const b = buckets.get(key) ?? { revenue: 0, cost: 0, count: 0 };
      b.revenue += fx.toBase(Number(j.actualRevenue), j.currency);
      b.cost += fx.toBase(Number(j.actualCost), j.currency);
      b.count += 1;
      buckets.set(key, b);
    }
    return this.toRows(buckets);
  }

  private toRows(buckets: Map<string, { revenue: number; cost: number; count: number }>) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const rows = [...buckets.entries()]
      .map(([group, b]) => ({
        group,
        revenue: r2(b.revenue),
        cost: r2(b.cost),
        grossProfit: r2(b.revenue - b.cost),
        marginPct: b.revenue > 0 ? r2(((b.revenue - b.cost) / b.revenue) * 100) : 0,
        count: b.count,
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
    const totals = rows.reduce(
      (t, r) => ({ revenue: r2(t.revenue + r.revenue), cost: r2(t.cost + r.cost), grossProfit: r2(t.grossProfit + r.grossProfit) }),
      { revenue: 0, cost: 0, grossProfit: 0 },
    );
    return {
      rows,
      totals: { ...totals, marginPct: totals.revenue > 0 ? r2((totals.grossProfit / totals.revenue) * 100) : 0 },
    };
  }
}
