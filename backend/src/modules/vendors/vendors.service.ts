import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { CreateVendorDto, UpdateVendorDto } from './vendors.dto';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private fx: FxService) {}

  /** Total WON spend per vendor in base currency (item totals are in the parent quotation's currency). */
  private async spendByVendor(vendorId?: string): Promise<Map<string, number>> {
    const fx = await this.fx.converter();
    const items = await this.prisma.quotationItem.findMany({
      where: { vendorId: vendorId ?? { not: null }, quotation: { status: 'WON' } },
      select: { vendorId: true, totalCost: true, quotation: { select: { currency: true } } },
    });
    const map = new Map<string, number>();
    for (const it of items) {
      const id = it.vendorId as string;
      map.set(id, (map.get(id) ?? 0) + fx.toBase(Number(it.totalCost), it.quotation.currency));
    }
    return map;
  }

  async list(dto: PaginationDto & { status?: string }) {
    const where: Prisma.VendorWhereInput = { deletedAt: null };
    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { code: { contains: dto.search, mode: 'insensitive' } },
        { contactPerson: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    if (dto.status) where.status = dto.status as never;
    const [items, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, orderBy: { name: 'asc' }, skip: (dto.page - 1) * dto.pageSize, take: dto.pageSize, include: { _count: { select: { rates: true, jobs: true } } } }),
      this.prisma.vendor.count({ where }),
    ]);
    const ids = items.map((v) => v.id);
    const ratings = await this.prisma.vendorRating.groupBy({ by: ['vendorId'], where: { vendorId: { in: ids } }, _avg: { overallScore: true } });
    const rateMap = new Map(ratings.map((r) => [r.vendorId, Number(r._avg.overallScore ?? 0)]));
    return paged(items.map((v) => ({ ...v, rating: rateMap.get(v.id) ?? null })), total, dto);
  }

  async get(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        rates: { orderBy: { effectiveDate: 'desc' }, include: { service: true } },
        ratings: { orderBy: { createdAt: 'desc' }, take: 10, include: { ratedBy: { select: { fullName: true } } } },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const [avg, spend] = await Promise.all([
      this.prisma.vendorRating.aggregate({ where: { vendorId: id }, _avg: { overallScore: true } }),
      this.spendByVendor(id),
    ]);
    return { ...vendor, rating: avg._avg.overallScore != null ? Number(avg._avg.overallScore) : null, totalSpend: spend.get(id) ?? 0 };
  }

  async create(dto: CreateVendorDto) {
    const code = await this.seq.next('vendor');
    return this.prisma.vendor.create({ data: { ...dto, code } });
  }

  async update(id: string, dto: UpdateVendorDto) {
    try {
      return await this.prisma.vendor.update({ where: { id }, data: dto });
    } catch (e) {
      rethrowPrisma(e, 'Vendor');
    }
  }

  /** Soft delete — moves the vendor to the recycle bin, restorable. */
  async remove(id: string) {
    const existing = await this.prisma.vendor.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Vendor not found');
    await this.prisma.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  /** Automatic vendor ranking: rating (50) + spend share (30) + preferred bonus (20). Spend in base currency. */
  async ranking() {
    const vendors = await this.prisma.vendor.findMany({ where: { status: 'ACTIVE', deletedAt: null } });
    const ratings = await this.prisma.vendorRating.groupBy({ by: ['vendorId'], _avg: { overallScore: true } });
    const spendMap = await this.spendByVendor();
    const rateMap = new Map(ratings.map((r) => [r.vendorId, Number(r._avg.overallScore ?? 0)]));
    const maxSpend = Math.max(1, ...spendMap.values());
    return vendors
      .map((v) => {
        const rating = rateMap.get(v.id) ?? 0;
        const totalSpend = spendMap.get(v.id) ?? 0;
        const score = (rating / 5) * 50 + (totalSpend / maxSpend) * 30 + (v.isPreferred ? 20 : 0);
        return { id: v.id, code: v.code, name: v.name, rating, totalSpend, isPreferred: v.isPreferred, score: Math.round(score * 10) / 10 };
      })
      .sort((a, b) => b.score - a.score)
      .map((v, i) => ({ rank: i + 1, ...v }));
  }
}
