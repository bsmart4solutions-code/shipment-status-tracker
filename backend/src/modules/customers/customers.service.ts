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
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
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

  // Date-string fields that must be parsed to Date before hitting Prisma.
  private static readonly DATE_FIELDS = [
    'openingBalanceDate', 'firstContactDate', 'customerSince', 'lastContactDate',
    'lastSalesDate', 'nextFollowUp', 'birthday', 'companyAnniversary',
  ] as const;

  /**
   * Split a DTO into the customer's scalar Prisma data (dates parsed) and the
   * nested child arrays. Nested arrays are returned only when present so an
   * omitted array on update means "leave those rows untouched".
   */
  private splitDto(dto: CreateCustomerDto | UpdateCustomerDto) {
    const { contacts, addresses, documents, bankAccounts, ...rest } = dto as UpdateCustomerDto;
    const scalar: Record<string, unknown> = { ...rest };
    for (const f of CustomersService.DATE_FIELDS) {
      if (scalar[f] !== undefined) scalar[f] = scalar[f] ? new Date(scalar[f] as string) : null;
    }
    return { scalar, contacts, addresses, documents, bankAccounts };
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        ratings: { orderBy: { createdAt: 'desc' }, take: 10, include: { ratedBy: { select: { fullName: true } } } },
        contacts: { orderBy: { sortOrder: 'asc' } },
        addresses: { orderBy: { sortOrder: 'asc' } },
        documents: { orderBy: { uploadedAt: 'desc' } },
        bankAccounts: { orderBy: { sortOrder: 'asc' } },
        assignedSalesperson: { select: { id: true, fullName: true } },
      },
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

  async create(dto: CreateCustomerDto, userId?: string) {
    const code = await this.seq.next('customer');
    const { scalar, contacts, addresses, documents, bankAccounts } = this.splitDto(dto);
    try {
      return await this.prisma.customer.create({
        data: {
          ...(scalar as Prisma.CustomerUncheckedCreateInput),
          code,
          createdById: userId ?? null,
          updatedById: userId ?? null,
          contacts: contacts?.length ? { create: contacts.map((c, i) => ({ ...c, sortOrder: i })) } : undefined,
          addresses: addresses?.length ? { create: addresses.map((a, i) => ({ ...a, sortOrder: i })) } : undefined,
          documents: documents?.length ? { create: documents } : undefined,
          bankAccounts: bankAccounts?.length ? { create: bankAccounts.map((b, i) => ({ ...b, sortOrder: i })) } : undefined,
        },
      });
    } catch (e) {
      rethrowPrisma(e, 'Customer');
    }
  }

  async update(id: string, dto: UpdateCustomerDto, userId?: string) {
    const { scalar, contacts, addresses, documents, bankAccounts } = this.splitDto(dto);
    try {
      // Nested arrays, when supplied, fully replace the existing rows in one
      // transaction (an omitted array leaves those rows as they are).
      return await this.prisma.$transaction(async (tx) => {
        if (contacts) {
          await tx.customerContact.deleteMany({ where: { customerId: id } });
          if (contacts.length) await tx.customerContact.createMany({ data: contacts.map((c, i) => ({ ...c, customerId: id, sortOrder: i })) });
        }
        if (addresses) {
          await tx.customerAddress.deleteMany({ where: { customerId: id } });
          if (addresses.length) await tx.customerAddress.createMany({ data: addresses.map((a, i) => ({ ...a, customerId: id, sortOrder: i })) });
        }
        if (documents) {
          await tx.customerDocument.deleteMany({ where: { customerId: id } });
          if (documents.length) await tx.customerDocument.createMany({ data: documents.map((d) => ({ ...d, customerId: id })) });
        }
        if (bankAccounts) {
          await tx.customerBankAccount.deleteMany({ where: { customerId: id } });
          if (bankAccounts.length) await tx.customerBankAccount.createMany({ data: bankAccounts.map((b, i) => ({ ...b, customerId: id, sortOrder: i })) });
        }
        return tx.customer.update({ where: { id }, data: { ...(scalar as Prisma.CustomerUncheckedUpdateInput), updatedById: userId ?? null } });
      });
    } catch (e) {
      rethrowPrisma(e, 'Customer');
    }
  }

  /** Soft delete — moves the customer to the recycle bin, restorable. */
  async remove(id: string) {
    const existing = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Customer not found');
    await this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  /** Automatic customer ranking: weighted revenue + profit + rating, normalized 0-100 (base currency). */
  async ranking() {
    const fx = await this.fx.converter();
    const customers = await this.prisma.customer.findMany({ where: { status: 'ACTIVE', deletedAt: null } });
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
