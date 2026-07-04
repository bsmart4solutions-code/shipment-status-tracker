import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { SettingsService } from '../../common/settings.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { CompareRatesDto, CreateRateDto, UpdateRateDto } from './rates.dto';

@Injectable()
export class RatesService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  async list(dto: PaginationDto & { vendorId?: string; serviceId?: string }) {
    const where: Prisma.VendorServiceRateWhereInput = {};
    if (dto.vendorId) where.vendorId = dto.vendorId;
    if (dto.serviceId) where.serviceId = dto.serviceId;
    if (dto.search) {
      where.OR = [
        { origin: { contains: dto.search, mode: 'insensitive' } },
        { destination: { contains: dto.search, mode: 'insensitive' } },
        { vendor: { name: { contains: dto.search, mode: 'insensitive' } } },
        { service: { name: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.vendorServiceRate.findMany({
        where, include: { vendor: { select: { name: true, code: true, isPreferred: true } }, service: { select: { name: true } } },
        orderBy: [{ effectiveDate: 'desc' }], skip: (dto.page - 1) * dto.pageSize, take: dto.pageSize,
      }),
      this.prisma.vendorServiceRate.count({ where }),
    ]);
    return paged(items, total, dto);
  }

  create(dto: CreateRateDto) {
    return this.prisma.vendorServiceRate.create({
      data: {
        ...dto,
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      },
    });
  }

  async update(id: string, dto: UpdateRateDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.effectiveDate) data.effectiveDate = new Date(dto.effectiveDate);
    if (dto.expiryDate !== undefined) data.expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    try {
      return await this.prisma.vendorServiceRate.update({ where: { id }, data });
    } catch (e) {
      rethrowPrisma(e, 'Rate');
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.vendorServiceRate.delete({ where: { id } });
    } catch (e) {
      rethrowPrisma(e, 'Rate');
    }
    return { deleted: true };
  }

  /**
   * Vendor Comparison — the key feature.
   * Returns all vendors serving a service+lane with cost, rating, preferred
   * flag and a recommendation score. Weights are configurable in settings.
   */
  async compare(dto: CompareRatesDto) {
    const asOf = dto.date ? new Date(dto.date) : new Date();
    const where: Prisma.VendorServiceRateWhereInput = {
      serviceId: dto.serviceId,
      vendor: { status: 'ACTIVE' },
    };
    if (dto.origin) where.origin = { equals: dto.origin, mode: 'insensitive' };
    if (dto.destination) where.destination = { equals: dto.destination, mode: 'insensitive' };
    if (dto.country) where.country = { equals: dto.country, mode: 'insensitive' };
    if (dto.includeExpired !== 'true') {
      where.effectiveDate = { lte: asOf };
      where.OR = [{ expiryDate: null }, { expiryDate: { gte: asOf } }];
    }

    const rates = await this.prisma.vendorServiceRate.findMany({
      where,
      include: { vendor: { select: { id: true, name: true, code: true, isPreferred: true } }, service: { select: { name: true } } },
      orderBy: { cost: 'asc' },
    });
    if (!rates.length) return { items: [], recommendation: null };

    const vendorIds = [...new Set(rates.map((r) => r.vendorId))];
    const ratings = await this.prisma.vendorRating.groupBy({ by: ['vendorId'], where: { vendorId: { in: vendorIds } }, _avg: { overallScore: true } });
    const ratingMap = new Map(ratings.map((r) => [r.vendorId, Number(r._avg.overallScore ?? 0)]));

    const weights = await this.settings.get('recommendation.weights', { cost: 50, rating: 30, preferred: 20 });
    const minCost = Math.min(...rates.map((r) => Number(r.cost)));

    let items = rates.map((r) => {
      const cost = Number(r.cost);
      const rating = ratingMap.get(r.vendorId) ?? 0;
      const costScore = (minCost / cost) * weights.cost;             // cheapest gets full weight
      const ratingScore = (rating / 5) * weights.rating;
      const preferredScore = r.vendor.isPreferred ? weights.preferred : 0;
      return {
        rateId: r.id, vendorId: r.vendorId, vendor: r.vendor.name, vendorCode: r.vendor.code,
        service: r.service.name, origin: r.origin, destination: r.destination,
        rateType: r.rateType, currency: r.currency, cost,
        minimumCharge: r.minimumCharge != null ? Number(r.minimumCharge) : null,
        rating: Math.round(rating * 100) / 100, isPreferred: r.vendor.isPreferred,
        effectiveDate: r.effectiveDate, expiryDate: r.expiryDate,
        isExpired: r.expiryDate != null && r.expiryDate < asOf,
        score: Math.round((costScore + ratingScore + preferredScore) * 10) / 10,
      };
    });

    if (dto.sort === 'rating') items = items.sort((a, b) => b.rating - a.rating);
    else if (dto.sort === 'preferred') items = items.sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.cost - b.cost);
    else if (dto.sort === 'cost') items = items.sort((a, b) => a.cost - b.cost);
    else items = items.sort((a, b) => b.score - a.score);

    const active = items.filter((i) => !i.isExpired);
    return { items, recommendation: active.length ? [...active].sort((a, b) => b.score - a.score)[0] : null };
  }
}
