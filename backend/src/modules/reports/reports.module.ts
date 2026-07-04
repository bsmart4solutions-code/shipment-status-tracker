import { Controller, Get, Header, Module, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { toCsv } from '../../common/csv.util';
import { FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';
import { PnlModule } from '../pnl/pnl.module';
import { PnlFilter, PnlService } from '../pnl/pnl.service';
import { RatesModule } from '../rates/rates.module';
import { RatesService } from '../rates/rates.service';

/**
 * Exportable reports. Every report returns CSV (opens directly in Excel);
 * the frontend offers print-to-PDF for the same datasets. Report list:
 * quotations, vendors, customers, pnl, vendor-comparison, customer-profitability,
 * sales, revenue, gross-profit.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
class ReportsController {
  constructor(private prisma: PrismaService, private pnl: PnlService, private rates: RatesService, private fx: FxService) {}

  @Get(':type/export')
  @RequirePermission('reports.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@Param('type') type: string, @Query() query: Record<string, string>) {
    switch (type) {
      case 'quotations': return this.quotations(query);
      case 'vendors': return this.vendors();
      case 'customers': return this.customers();
      case 'pnl': return this.pnlReport(query);
      case 'vendor-comparison': return this.vendorComparison(query);
      case 'customer-profitability': return this.customerProfitability();
      case 'sales': return this.pnlReport({ ...query, groupBy: 'salesperson' });
      case 'revenue': return this.pnlReport({ ...query, groupBy: 'month' });
      case 'gross-profit': return this.pnlReport({ ...query, groupBy: 'month' });
      default: throw new BadRequestException(`Unknown report type: ${type}`);
    }
  }

  private async quotations(q: Record<string, string>) {
    const rows = await this.prisma.quotation.findMany({
      where: {
        status: (q.status as never) || undefined,
        quoteDate: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined },
      },
      include: { customer: { select: { companyName: true } }, salesPerson: { select: { fullName: true } } },
      orderBy: { quoteDate: 'desc' },
    });
    return toCsv(
      ['Quote No', 'Date', 'Customer', 'Sales Person', 'Status', 'Currency', 'Total Cost', 'Selling Price', 'Gross Profit', 'GP %'],
      rows.map((r) => [r.quoteNumber, r.quoteDate.toISOString().slice(0, 10), r.customer.companyName, r.salesPerson?.fullName, r.status, r.currency, String(r.totalCost), String(r.sellingPrice), String(r.grossProfit), String(r.gpPercent)]),
    );
  }

  private async vendors() {
    const rows = await this.prisma.vendor.findMany({ include: { _count: { select: { rates: true, jobs: true } } }, orderBy: { name: 'asc' } });
    const ratings = await this.prisma.vendorRating.groupBy({ by: ['vendorId'], _avg: { overallScore: true } });
    const map = new Map(ratings.map((r) => [r.vendorId, Number(r._avg.overallScore ?? 0)]));
    return toCsv(
      ['Code', 'Name', 'Contact', 'Phone', 'Email', 'Payment Term', 'Status', 'Preferred', 'Rating', 'Rates', 'Jobs'],
      rows.map((v) => [v.code, v.name, v.contactPerson, v.phone, v.email, v.paymentTerm, v.status, v.isPreferred ? 'Yes' : 'No', map.get(v.id)?.toFixed(2) ?? '', v._count.rates, v._count.jobs]),
    );
  }

  private async customers() {
    const fx = await this.fx.converter();
    const rows = await this.prisma.customer.findMany({ orderBy: { companyName: 'asc' } });
    const stats = await this.prisma.quotation.groupBy({ by: ['customerId', 'currency'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true } });
    const map = new Map<string, { revenue: number; profit: number }>();
    for (const s of stats) {
      const acc = map.get(s.customerId) ?? { revenue: 0, profit: 0 };
      acc.revenue += fx.toBase(Number(s._sum.sellingPrice ?? 0), s.currency);
      acc.profit += fx.toBase(Number(s._sum.grossProfit ?? 0), s.currency);
      map.set(s.customerId, acc);
    }
    return toCsv(
      ['Code', 'Company', 'PIC', 'Phone', 'Email', 'Industry', 'Payment Term', 'Credit Limit', 'Status', 'Priority', `Revenue (${fx.baseCurrency})`, `Profit (${fx.baseCurrency})`],
      rows.map((c) => [c.code, c.companyName, c.pic, c.phone, c.email, c.industry, c.paymentTerm, String(c.creditLimit ?? ''), c.status, c.priority, (map.get(c.id)?.revenue ?? 0).toFixed(2), (map.get(c.id)?.profit ?? 0).toFixed(2)]),
    );
  }

  private async pnlReport(q: Record<string, string>) {
    const result = await this.pnl.report(q as unknown as PnlFilter);
    return toCsv(
      ['Group', 'Revenue', 'Vendor Cost', 'Gross Profit', 'Margin %', 'Count'],
      [...result.rows.map((r) => [r.group, r.revenue, r.cost, r.grossProfit, r.marginPct, r.count] as (string | number)[]),
       ['TOTAL', result.totals.revenue, result.totals.cost, result.totals.grossProfit, result.totals.marginPct, '']],
    );
  }

  private async vendorComparison(q: Record<string, string>) {
    if (!q.serviceId) throw new BadRequestException('serviceId is required');
    const result = await this.rates.compare(q as never);
    return toCsv(
      ['Vendor', 'Service', 'Origin', 'Destination', 'Rate Type', 'Currency', 'Cost', 'Min Charge', 'Rating', 'Preferred', 'Effective', 'Expiry', 'Score'],
      result.items.map((i) => [i.vendor, i.service, i.origin, i.destination, i.rateType, i.currency, i.cost, i.minimumCharge ?? '', i.rating, i.isPreferred ? 'Yes' : 'No', i.effectiveDate?.toISOString().slice(0, 10), i.expiryDate?.toISOString().slice(0, 10) ?? '', i.score]),
    );
  }

  private async customerProfitability() {
    const fx = await this.fx.converter();
    const stats = await this.prisma.quotation.groupBy({ by: ['customerId', 'currency'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true }, _count: true });
    const byCustomer = new Map<string, { revenue: number; gp: number; count: number }>();
    for (const s of stats) {
      const acc = byCustomer.get(s.customerId) ?? { revenue: 0, gp: 0, count: 0 };
      acc.revenue += fx.toBase(Number(s._sum.sellingPrice ?? 0) - Number(s._sum.taxAmt ?? 0), s.currency);
      acc.gp += fx.toBase(Number(s._sum.grossProfit ?? 0), s.currency);
      acc.count += s._count;
      byCustomer.set(s.customerId, acc);
    }
    const customers = await this.prisma.customer.findMany({ where: { id: { in: [...byCustomer.keys()] } }, select: { id: true, code: true, companyName: true } });
    const map = new Map(customers.map((c) => [c.id, c]));
    return toCsv(
      ['Code', 'Customer', 'Won Quotations', `Revenue (${fx.baseCurrency})`, `Gross Profit (${fx.baseCurrency})`, 'Margin %'],
      [...byCustomer.entries()]
        .map(([customerId, s]) => {
          return [map.get(customerId)?.code ?? '', map.get(customerId)?.companyName ?? '?', s.count, s.revenue.toFixed(2), s.gp.toFixed(2), s.revenue > 0 ? ((s.gp / s.revenue) * 100).toFixed(2) : '0'];
        })
        .sort((a, b) => Number(b[3]) - Number(a[3])),
    );
  }
}

@Module({ imports: [PnlModule, RatesModule], controllers: [ReportsController] })
export class ReportsModule {}
