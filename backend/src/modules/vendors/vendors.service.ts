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

  // Date-string fields that must be parsed to Date before hitting Prisma.
  private static readonly DATE_FIELDS = [
    'openingBalanceDate', 'onboardedDate', 'contractStart', 'contractEnd',
    'insuranceExpiry', 'nextReviewDate',
  ] as const;

  /** Split a DTO into scalar vendor data (dates parsed) and nested child arrays. */
  private splitDto(dto: CreateVendorDto | UpdateVendorDto) {
    const { contacts, addresses, documents, bankAccounts, ...rest } = dto as UpdateVendorDto;
    const scalar: Record<string, unknown> = { ...rest };
    for (const f of VendorsService.DATE_FIELDS) {
      if (scalar[f] !== undefined) scalar[f] = scalar[f] ? new Date(scalar[f] as string) : null;
    }
    return { scalar, contacts, addresses, documents, bankAccounts };
  }

  async get(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        rates: { orderBy: { effectiveDate: 'desc' }, include: { service: true } },
        ratings: { orderBy: { createdAt: 'desc' }, take: 10, include: { ratedBy: { select: { fullName: true } } } },
        contacts: { orderBy: { sortOrder: 'asc' } },
        addresses: { orderBy: { sortOrder: 'asc' } },
        documents: { orderBy: { uploadedAt: 'desc' } },
        bankAccounts: { orderBy: { sortOrder: 'asc' } },
        assignedBuyer: { select: { id: true, fullName: true } },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const [avg, spend] = await Promise.all([
      this.prisma.vendorRating.aggregate({ where: { vendorId: id }, _avg: { overallScore: true } }),
      this.spendByVendor(id),
    ]);
    return { ...vendor, rating: avg._avg.overallScore != null ? Number(avg._avg.overallScore) : null, totalSpend: spend.get(id) ?? 0 };
  }

  async create(dto: CreateVendorDto, userId?: string) {
    const code = await this.seq.next('vendor');
    const { scalar, contacts, addresses, documents, bankAccounts } = this.splitDto(dto);
    try {
      return await this.prisma.vendor.create({
        data: {
          ...(scalar as Prisma.VendorUncheckedCreateInput),
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
      rethrowPrisma(e, 'Vendor');
    }
  }

  async update(id: string, dto: UpdateVendorDto, userId?: string) {
    const { scalar, contacts, addresses, documents, bankAccounts } = this.splitDto(dto);
    try {
      // A supplied child array replaces those rows; an omitted one is untouched.
      return await this.prisma.$transaction(async (tx) => {
        if (contacts) {
          await tx.vendorContact.deleteMany({ where: { vendorId: id } });
          if (contacts.length) await tx.vendorContact.createMany({ data: contacts.map((c, i) => ({ ...c, vendorId: id, sortOrder: i })) });
        }
        if (addresses) {
          await tx.vendorAddress.deleteMany({ where: { vendorId: id } });
          if (addresses.length) await tx.vendorAddress.createMany({ data: addresses.map((a, i) => ({ ...a, vendorId: id, sortOrder: i })) });
        }
        if (documents) {
          await tx.vendorDocument.deleteMany({ where: { vendorId: id } });
          if (documents.length) await tx.vendorDocument.createMany({ data: documents.map((d) => ({ ...d, vendorId: id })) });
        }
        if (bankAccounts) {
          await tx.vendorBankAccount.deleteMany({ where: { vendorId: id } });
          if (bankAccounts.length) await tx.vendorBankAccount.createMany({ data: bankAccounts.map((b, i) => ({ ...b, vendorId: id, sortOrder: i })) });
        }
        return tx.vendor.update({ where: { id }, data: { ...(scalar as Prisma.VendorUncheckedUpdateInput), updatedById: userId ?? null } });
      });
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
