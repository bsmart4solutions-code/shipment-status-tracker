import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { computeItem, computeQuotation } from '../costing/costing.engine';
import { CreateQuotationDto, QuotationItemDto, UpdateQuotationDto } from './quotations.dto';

@Injectable()
export class QuotationsService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private settings: SettingsService,
  ) {}

  private baseCurrency() {
    return process.env.BASE_CURRENCY || 'MYR';
  }

  /** Latest fx rate for cost currency -> quotation currency (1 when same). */
  private async fxRate(from: string, to: string): Promise<number> {
    if (from === to) return 1;
    const direct = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: from, quoteCurrency: to },
      orderBy: { effectiveDate: 'desc' },
    });
    if (direct) return Number(direct.rate);
    const inverse = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: to, quoteCurrency: from },
      orderBy: { effectiveDate: 'desc' },
    });
    if (inverse) return 1 / Number(inverse.rate);
    throw new BadRequestException(`No exchange rate configured for ${from} -> ${to}`);
  }

  /** Run every raw item through the costing engine, resolving fx per item. */
  private async priceItems(items: QuotationItemDto[], quoteCurrency: string) {
    const priced = [];
    for (const [i, item] of items.entries()) {
      const fx = await this.fxRate(item.costCurrency || quoteCurrency, quoteCurrency);
      const result = computeItem({
        quantity: item.quantity,
        unitCost: item.unitCost,
        fxRate: fx,
        minimumCharge: item.minimumCharge,
        markupPct: item.markupPct,
        unitSell: item.unitSell,
      });
      priced.push({
        serviceId: item.serviceId,
        vendorId: item.vendorId ?? null,
        rateId: item.rateId ?? null,
        description: item.description ?? null,
        quantity: item.quantity,
        unit: item.unit ?? null,
        costCurrency: item.costCurrency || quoteCurrency,
        fxRate: fx,
        unitCost: item.unitCost,
        minimumCharge: item.minimumCharge ?? null,
        markupPct: result.markupPct,
        unitSell: result.unitSell,
        totalCost: result.totalCost,
        totalSell: result.totalSell,
        grossProfit: result.grossProfit,
        gpPercent: result.gpPercent,
        sortOrder: i + 1,
        _result: result,
      });
    }
    return priced;
  }

  async list(dto: PaginationDto & { status?: string; customerId?: string; salesPersonId?: string; from?: string; to?: string }) {
    const where: Prisma.QuotationWhereInput = {};
    if (dto.search) {
      where.OR = [
        { quoteNumber: { contains: dto.search, mode: 'insensitive' } },
        { customer: { companyName: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }
    if (dto.status) where.status = dto.status as never;
    if (dto.customerId) where.customerId = dto.customerId;
    if (dto.salesPersonId) where.salesPersonId = dto.salesPersonId;
    if (dto.from || dto.to) where.quoteDate = { gte: dto.from ? new Date(dto.from) : undefined, lte: dto.to ? new Date(dto.to) : undefined };
    const [items, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        include: { customer: { select: { companyName: true, code: true } }, salesPerson: { select: { fullName: true } }, _count: { select: { items: true } } },
        orderBy: { quoteDate: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.quotation.count({ where }),
    ]);
    return paged(items, total, dto);
  }

  async get(id: string) {
    const quote = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        customer: true,
        salesPerson: { select: { id: true, fullName: true } },
        items: { orderBy: { sortOrder: 'asc' }, include: { service: { select: { name: true } }, vendor: { select: { name: true } } } },
        jobs: { select: { id: true, jobNumber: true, status: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quotation not found');
    return quote;
  }

  async create(dto: CreateQuotationDto, userId?: string) {
    const defaults = await this.settings.get('quotation.defaults', { markupPct: 20, taxPct: 0, validityDays: 30 });
    const currency = dto.currency || this.baseCurrency();
    const items = await this.priceItems(
      dto.items.map((i) => ({ ...i, markupPct: i.markupPct ?? defaults.markupPct })),
      currency,
    );
    const taxPct = dto.taxPct ?? defaults.taxPct;
    const totals = computeQuotation(items.map((i) => i._result), {
      discountPct: dto.discountPct, discountAmt: dto.discountAmt,
      serviceChargePct: dto.serviceChargePct, miscCharge: dto.miscCharge, taxPct,
    });
    const quoteNumber = await this.seq.next('quotation');
    const validityDate = dto.validityDate
      ? new Date(dto.validityDate)
      : new Date(Date.now() + defaults.validityDays * 86400000);

    const quote = await this.prisma.quotation.create({
      data: {
        quoteNumber,
        customerId: dto.customerId,
        quoteDate: dto.quoteDate ? new Date(dto.quoteDate) : new Date(),
        validityDate,
        salesPersonId: dto.salesPersonId ?? userId ?? null,
        currency,
        discountPct: dto.discountPct ?? 0,
        discountAmt: totals.discountAmt,
        serviceChargePct: dto.serviceChargePct ?? 0,
        miscCharge: totals.miscCharge,
        taxPct,
        taxAmt: totals.taxAmt,
        totalCost: totals.totalCost,
        subtotalSell: totals.subtotalSell,
        sellingPrice: totals.sellingPrice,
        grossProfit: totals.grossProfit,
        gpPercent: totals.gpPercent,
        remark: dto.remark,
        items: { create: items.map(({ _result, ...item }) => item) },
      },
      include: { items: true },
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'CREATE', entityType: 'quotation', entityId: quote.id, detail: { quoteNumber } } });
    return quote;
  }

  /** Full update: replaces items and re-runs the costing engine. */
  async update(id: string, dto: UpdateQuotationDto, userId?: string) {
    const existing = await this.prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    if (['WON', 'LOST', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestException(`Cannot edit a ${existing.status} quotation`);
    }

    const currency = dto.currency || existing.currency;
    const rawItems = dto.items ?? [];
    const items = rawItems.length ? await this.priceItems(rawItems, currency) : null;

    const charges = {
      discountPct: dto.discountPct ?? Number(existing.discountPct),
      discountAmt: dto.discountAmt,
      serviceChargePct: dto.serviceChargePct ?? Number(existing.serviceChargePct),
      miscCharge: dto.miscCharge ?? Number(existing.miscCharge),
      taxPct: dto.taxPct ?? Number(existing.taxPct),
    };

    return this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        await tx.quotationItem.createMany({ data: items.map(({ _result, ...item }) => ({ ...item, quotationId: id })) });
      }
      const currentItems = items
        ? items.map((i) => i._result)
        : (await tx.quotationItem.findMany({ where: { quotationId: id } })).map((i) => ({
            unitSell: Number(i.unitSell), markupPct: Number(i.markupPct),
            totalCost: Number(i.totalCost), totalSell: Number(i.totalSell),
            grossProfit: Number(i.grossProfit), gpPercent: Number(i.gpPercent),
          }));
      const totals = computeQuotation(currentItems, charges);
      const quote = await tx.quotation.update({
        where: { id },
        data: {
          customerId: dto.customerId ?? existing.customerId,
          quoteDate: dto.quoteDate ? new Date(dto.quoteDate) : undefined,
          validityDate: dto.validityDate ? new Date(dto.validityDate) : undefined,
          salesPersonId: dto.salesPersonId ?? existing.salesPersonId,
          currency,
          discountPct: charges.discountPct,
          discountAmt: totals.discountAmt,
          serviceChargePct: charges.serviceChargePct,
          miscCharge: totals.miscCharge,
          taxPct: charges.taxPct,
          taxAmt: totals.taxAmt,
          totalCost: totals.totalCost,
          subtotalSell: totals.subtotalSell,
          sellingPrice: totals.sellingPrice,
          grossProfit: totals.grossProfit,
          gpPercent: totals.gpPercent,
          remark: dto.remark ?? existing.remark,
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      await tx.auditLog.create({ data: { userId, action: 'UPDATE', entityType: 'quotation', entityId: id } });
      return quote;
    });
  }

  async setStatus(id: string, status: 'DRAFT' | 'SENT' | 'WON' | 'LOST' | 'CANCELLED', userId?: string) {
    const quote = await this.prisma.quotation.update({ where: { id }, data: { status } }).catch(() => null);
    if (!quote) throw new NotFoundException('Quotation not found');
    await this.prisma.auditLog.create({ data: { userId, action: 'STATUS', entityType: 'quotation', entityId: id, detail: { status } } });
    return quote;
  }

  /** Quotation → Job conversion (automation). Marks the quote WON and copies commercials. */
  async convertToJob(id: string, userId?: string) {
    const quote = await this.get(id);
    if (quote.status === 'CANCELLED' || quote.status === 'LOST') {
      throw new BadRequestException(`Cannot convert a ${quote.status} quotation`);
    }
    const jobNumber = await this.seq.next('job');
    // Primary vendor: the one carrying the largest cost share
    const vendorTotals = new Map<string, number>();
    for (const item of quote.items) {
      if (item.vendorId) vendorTotals.set(item.vendorId, (vendorTotals.get(item.vendorId) ?? 0) + Number(item.totalCost));
    }
    const primaryVendorId = [...vendorTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const job = await this.prisma.$transaction(async (tx) => {
      const j = await tx.job.create({
        data: {
          jobNumber,
          customerId: quote.customerId,
          quotationId: quote.id,
          vendorId: primaryVendorId,
          currency: quote.currency,
          actualCost: quote.totalCost,
          actualRevenue: quote.sellingPrice,
          profit: quote.grossProfit,
          status: 'OPEN',
        },
      });
      if (quote.status !== 'WON') await tx.quotation.update({ where: { id }, data: { status: 'WON' } });
      await tx.auditLog.create({ data: { userId, action: 'CONVERT', entityType: 'quotation', entityId: id, detail: { jobNumber } } });
      return j;
    });
    return job;
  }

  async remove(id: string, userId?: string) {
    await this.prisma.quotation.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Quotation not found');
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'DELETE', entityType: 'quotation', entityId: id } });
    return { deleted: true };
  }
}
