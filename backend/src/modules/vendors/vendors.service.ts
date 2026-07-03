import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { CreateVendorDto, UpdateVendorDto } from './vendors.dto';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService, private seq: SequenceService) {}

  async list(dto: PaginationDto & { status?: string }) {
    const where: Prisma.VendorWhereInput = {};
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
      this.prisma.quotationItem.aggregate({ where: { vendorId: id, quotation: { status: 'WON' } }, _sum: { totalCost: true } }),
    ]);
    return { ...vendor, rating: avg._avg.overallScore != null ? Number(avg._avg.overallScore) : null, totalSpend: Number(spend._sum.totalCost ?? 0) };
  }

  async create(dto: CreateVendorDto) {
    const code = await this.seq.next('vendor');
    return this.prisma.vendor.create({ data: { ...dto, code } });
  }

  update(id: string, dto: UpdateVendorDto) {
    return this.prisma.vendor.update({ where: { id }, data: dto }).catch(() => {
      throw new NotFoundException('Vendor not found');
    });
  }

  async remove(id: string) {
    await this.prisma.vendor.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Vendor not found');
    });
    return { deleted: true };
  }

  /** Automatic vendor ranking: rating (50) + spend share (30) + preferred bonus (20). */
  async ranking() {
    const vendors = await this.prisma.vendor.findMany({ where: { status: 'ACTIVE' } });
    const ratings = await this.prisma.vendorRating.groupBy({ by: ['vendorId'], _avg: { overallScore: true } });
    const spend = await this.prisma.quotationItem.groupBy({ by: ['vendorId'], where: { quotation: { status: 'WON' }, vendorId: { not: null } }, _sum: { totalCost: true } });
    const rateMap = new Map(ratings.map((r) => [r.vendorId, Number(r._avg.overallScore ?? 0)]));
    const spendMap = new Map(spend.map((s) => [s.vendorId, Number(s._sum.totalCost ?? 0)]));
    const maxSpend = Math.max(1, ...spend.map((s) => Number(s._sum.totalCost ?? 0)));
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
