import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private fx: FxService) {}

  async list(dto: PaginationDto & { status?: string }) {
    const where: Prisma.CustomerWhereInput = {};
    if (dto.search) {
      where.OR = [
        { companyName: { contains: dto.search, mode: 'insensitive' } },
        { code: { contains: dto.search, mode: 'insensitive' } },
        { pic: { contains: dto.search, mode: 'insensitive' } },
        { email: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    if (dto.status) where.status = dto.status as never;
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: { companyName: 'asc' }, skip: (dto.page - 1) * dto.pageSize, take: dto.pageSize }),
      this.prisma.customer.count({ where }),
    ]);
    // Attach calculated stats in one aggregate pass (per-currency, converted to base)
    const ids = items.map((c) => c.id);
    const fx = await this.fx.converter();
    const [stats, ratings] = await Promise.all([
      this.prisma.quotation.groupBy({
        by: ['customerId', 'currency'], where: { customerId: { in: ids }, status: 'WON' },
        _sum: { sellingPrice: true, grossProfit: true }, _max: { quoteDate: true },
      }),
      this.prisma.customerRating.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _avg: { overallScore: true } }),
    ]);
    const statMap = new Map<string, { revenue: number; profit: number; last: Date | null }>();
    for (const s of stats) {
      const acc = statMap.get(s.customerId) ?? { revenue: 0, profit: 0, last: null };
      acc.revenue += fx.toBase(Number(s._sum.sellingPrice ?? 0), s.currency);
      acc.profit += fx.toBase(Number(s._sum.grossProfit ?? 0), s.currency);
      if (s._max.quoteDate && (!acc.last || s._max.quoteDate > acc.last)) acc.last = s._max.quoteDate;
      statMap.set(s.customerId, acc);
    }
    const rateMap = new Map(ratings.map((r) => [r.customerId, r._avg.overallScore]));
    const enriched = items.map((c) => ({
      ...c,
      totalRevenue: statMap.get(c.id)?.revenue ?? 0,
      totalProfit: statMap.get(c.id)?.profit ?? 0,
      lastQuotation: statMap.get(c.id)?.last ?? null,
      rating: rateMap.get(c.id) != null ? Number(rateMap.get(c.id)) : null,
    }));
    return paged(enriched, total, dto);
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { ratings: { orderBy: { createdAt: 'desc' }, take: 10, include: { ratedBy: { select: { fullName: true } } } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const fx = await this.fx.converter();
    const [agg, lastQuote, jobCount] = await Promise.all([
      this.prisma.quotation.groupBy({ by: ['currency'], where: { customerId: id, status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true }, _count: true }),
      this.prisma.quotation.findFirst({ where: { customerId: id }, orderBy: { quoteDate: 'desc' } }),
      this.prisma.job.count({ where: { customerId: id } }),
    ]);
    const totals = agg.reduce(
      (t, g) => ({
        revenue: t.revenue + fx.toBase(Number(g._sum.sellingPrice ?? 0), g.currency),
        profit: t.profit + fx.toBase(Number(g._sum.grossProfit ?? 0), g.currency),
        count: t.count + g._count,
      }),
      { revenue: 0, profit: 0, count: 0 },
    );
    return {
      ...customer,
      totalRevenue: totals.revenue,
      totalProfit: totals.profit,
      wonQuotations: totals.count,
      lastQuotation: lastQuote?.quoteDate ?? null,
      jobCount,
    };
  }

  async create(dto: CreateCustomerDto) {
    const code = await this.seq.next('customer');
    return this.prisma.customer.create({ data: { ...dto, code } });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    try {
      return await this.prisma.customer.update({ where: { id }, data: dto });
    } catch (e) {
      rethrowPrisma(e, 'Customer');
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.customer.delete({ where: { id } });
    } catch (e) {
      rethrowPrisma(e, 'Customer', 'Customer has quotations/jobs/invoices — set status to INACTIVE instead of deleting');
    }
    return { deleted: true };
  }

  /** Automatic customer ranking: weighted revenue + profit + rating, normalized 0-100 (base currency). */
  async ranking() {
    const fx = await this.fx.converter();
    const customers = await this.prisma.customer.findMany({ where: { status: 'ACTIVE' } });
    const stats = await this.prisma.quotation.groupBy({ by: ['customerId', 'currency'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true } });
    const ratings = await this.prisma.customerRating.groupBy({ by: ['customerId'], _avg: { overallScore: true } });
    const statMap = new Map<string, { revenue: number; profit: number }>();
    for (const s of stats) {
      const acc = statMap.get(s.customerId) ?? { revenue: 0, profit: 0 };
      acc.revenue += fx.toBase(Number(s._sum.sellingPrice ?? 0), s.currency);
      acc.profit += fx.toBase(Number(s._sum.grossProfit ?? 0), s.currency);
      statMap.set(s.customerId, acc);
    }
    const rateMap = new Map(ratings.map((r) => [r.customerId, Number(r._avg.overallScore ?? 0)]));
    const maxRev = Math.max(1, ...[...statMap.values()].map((s) => s.revenue));
    const maxProfit = Math.max(1, ...[...statMap.values()].map((s) => s.profit));
    return customers
      .map((c) => {
        const rev = statMap.get(c.id)?.revenue ?? 0;
        const profit = statMap.get(c.id)?.profit ?? 0;
        const rating = rateMap.get(c.id) ?? 0;
        const score = (rev / maxRev) * 40 + (profit / maxProfit) * 40 + (rating / 5) * 20;
        return { id: c.id, code: c.code, companyName: c.companyName, revenue: rev, profit, rating, score: Math.round(score * 10) / 10 };
      })
      .sort((a, b) => b.score - a.score)
      .map((c, i) => ({ rank: i + 1, ...c }));
  }
}
