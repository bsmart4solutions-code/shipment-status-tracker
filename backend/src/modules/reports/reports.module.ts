import { Controller, Get, Header, Module, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { toCsv } from '../../common/csv.util';
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
  constructor(private prisma: PrismaService, private pnl: PnlService, private rates: RatesService) {}

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
    const rows = await this.prisma.customer.findMany({ orderBy: { companyName: 'asc' } });
    const stats = await this.prisma.quotation.groupBy({ by: ['customerId'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true } });
    const map = new Map(stats.map((s) => [s.customerId, s]));
    return toCsv(
      ['Code', 'Company', 'PIC', 'Phone', 'Email', 'Industry', 'Payment Term', 'Credit Limit', 'Status', 'Priority', 'Revenue', 'Profit'],
      rows.map((c) => [c.code, c.companyName, c.pic, c.phone, c.email, c.industry, c.paymentTerm, String(c.creditLimit ?? ''), c.status, c.priority, String(map.get(c.id)?._sum.sellingPrice ?? 0), String(map.get(c.id)?._sum.grossProfit ?? 0)]),
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
    const stats = await this.prisma.quotation.groupBy({ by: ['customerId'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true, taxAmt: true }, _count: true });
    const customers = await this.prisma.customer.findMany({ where: { id: { in: stats.map((s) => s.customerId) } }, select: { id: true, code: true, companyName: true } });
    const map = new Map(customers.map((c) => [c.id, c]));
    return toCsv(
      ['Code', 'Customer', 'Won Quotations', 'Revenue', 'Gross Profit', 'Margin %'],
      stats
        .map((s) => {
          const revenue = Number(s._sum.sellingPrice ?? 0) - Number(s._sum.taxAmt ?? 0);
          const gp = Number(s._sum.grossProfit ?? 0);
          return [map.get(s.customerId)?.code ?? '', map.get(s.customerId)?.companyName ?? '?', s._count, revenue.toFixed(2), gp.toFixed(2), revenue > 0 ? ((gp / revenue) * 100).toFixed(2) : '0'];
        })
        .sort((a, b) => Number(b[3]) - Number(a[3])),
    );
  }
}

@Module({ imports: [PnlModule, RatesModule], controllers: [ReportsController] })
export class ReportsModule {}
