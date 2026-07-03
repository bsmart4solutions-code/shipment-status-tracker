import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService, private seq: SequenceService) {}

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
    // Attach calculated stats in one aggregate pass
    const ids = items.map((c) => c.id);
    const [stats, ratings] = await Promise.all([
      this.prisma.quotation.groupBy({
        by: ['customerId'], where: { customerId: { in: ids }, status: 'WON' },
        _sum: { sellingPrice: true, grossProfit: true }, _max: { quoteDate: true },
      }),
      this.prisma.customerRating.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _avg: { overallScore: true } }),
    ]);
    const statMap = new Map(stats.map((s) => [s.customerId, s]));
    const rateMap = new Map(ratings.map((r) => [r.customerId, r._avg.overallScore]));
    const enriched = items.map((c) => ({
      ...c,
      totalRevenue: Number(statMap.get(c.id)?._sum.sellingPrice ?? 0),
      totalProfit: Number(statMap.get(c.id)?._sum.grossProfit ?? 0),
      lastQuotation: statMap.get(c.id)?._max.quoteDate ?? null,
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
    const [agg, lastQuote, jobCount] = await Promise.all([
      this.prisma.quotation.aggregate({ where: { customerId: id, status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true }, _count: true }),
      this.prisma.quotation.findFirst({ where: { customerId: id }, orderBy: { quoteDate: 'desc' } }),
      this.prisma.job.count({ where: { customerId: id } }),
    ]);
    return {
      ...customer,
      totalRevenue: Number(agg._sum.sellingPrice ?? 0),
      totalProfit: Number(agg._sum.grossProfit ?? 0),
      wonQuotations: agg._count,
      lastQuotation: lastQuote?.quoteDate ?? null,
      jobCount,
    };
  }

  async create(dto: CreateCustomerDto) {
    const code = await this.seq.next('customer');
    return this.prisma.customer.create({ data: { ...dto, code } });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Customer not found');
    });
  }

  async remove(id: string) {
    await this.prisma.customer.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Customer not found');
    });
    return { deleted: true };
  }

  /** Automatic customer ranking: weighted revenue + profit + rating, normalized 0-100. */
  async ranking() {
    const customers = await this.prisma.customer.findMany({ where: { status: 'ACTIVE' } });
    const stats = await this.prisma.quotation.groupBy({ by: ['customerId'], where: { status: 'WON' }, _sum: { sellingPrice: true, grossProfit: true } });
    const ratings = await this.prisma.customerRating.groupBy({ by: ['customerId'], _avg: { overallScore: true } });
    const statMap = new Map(stats.map((s) => [s.customerId, s]));
    const rateMap = new Map(ratings.map((r) => [r.customerId, Number(r._avg.overallScore ?? 0)]));
    const maxRev = Math.max(1, ...stats.map((s) => Number(s._sum.sellingPrice ?? 0)));
    const maxProfit = Math.max(1, ...stats.map((s) => Number(s._sum.grossProfit ?? 0)));
    return customers
      .map((c) => {
        const rev = Number(statMap.get(c.id)?._sum.sellingPrice ?? 0);
        const profit = Number(statMap.get(c.id)?._sum.grossProfit ?? 0);
        const rating = rateMap.get(c.id) ?? 0;
        const score = (rev / maxRev) * 40 + (profit / maxProfit) * 40 + (rating / 5) * 20;
        return { id: c.id, code: c.code, companyName: c.companyName, revenue: rev, profit, rating, score: Math.round(score * 10) / 10 };
      })
      .sort((a, b) => b.score - a.score)
      .map((c, i) => ({ rank: i + 1, ...c }));
  }
}
