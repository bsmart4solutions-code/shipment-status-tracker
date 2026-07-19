import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { MailService } from '../../common/mail.service';
import { PrismaService } from '../../common/prisma.service';
import { requestContext } from '../../common/request-context';
import { SequenceService } from '../../common/sequence.service';
import { SettingsService } from '../../common/settings.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { FxService } from '../../common/fx.service';
import { computeItem, computeQuotation } from '../costing/costing.engine';
import { assertQuotationStatusTransition } from '../../common/state-machine';
import { assertApprovalAllows, requiredApprovalStatus } from './approval.logic';
import { CreateQuotationDto, QuotationItemDto, UpdateQuotationDto } from './quotations.dto';

/** Minimal HTML escaping for values interpolated into email markup. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Injectable()
export class QuotationsService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private settings: SettingsService,
    private audit: AuditService,
    private mail: MailService,
    private fx: FxService,
  ) {}

  /**
   * Approval decision for a quotation total: convert to the base currency
   * (missing fx rates fall back 1:1 — the safer direction here is to ASK for
   * approval rather than skip it) and compare against the configured
   * threshold ("approval.quotation.thresholdBase", 0 = approvals disabled).
   */
  private async approvalStatusFor(sellingPrice: number, currency: string): Promise<'NOT_REQUIRED' | 'PENDING'> {
    const threshold = await this.settings.get('approval.quotation.thresholdBase', 0);
    if (!threshold || threshold <= 0) return 'NOT_REQUIRED';
    const conv = await this.fx.converter();
    return requiredApprovalStatus(conv.toBase(sellingPrice, currency), Number(threshold));
  }

  /** Broadcast a notification to approvers when a quote enters PENDING. */
  private async notifyPendingApproval(quoteId: string, quoteNumber: string) {
    await this.prisma.notification
      .create({
        data: {
          type: 'SYSTEM',
          title: 'Quotation needs approval',
          message: `${quoteNumber} is over the approval threshold and awaits review`,
          entityType: 'quotation',
          entityId: quoteId,
          dedupeKey: `APPR:${quoteId}`,
        },
      })
      .catch(() => undefined); // dedupe collision -> already notified
  }

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
        taxExempt: item.taxExempt ?? false,
        sortOrder: i + 1,
        _result: { ...result, taxExempt: item.taxExempt ?? false },
      });
    }
    return priced;
  }

  async list(dto: PaginationDto & { status?: string; customerId?: string; salesPersonId?: string; from?: string; to?: string }) {
    const where: Prisma.QuotationWhereInput = { deletedAt: null };
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
        salesPerson: { select: { id: true, fullName: true, email: true, phone: true } },
        items: { orderBy: { sortOrder: 'asc' }, include: { service: { select: { name: true } }, vendor: { select: { name: true } } } },
        jobs: { select: { id: true, jobNumber: true, status: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quotation not found');
    return quote;
  }

  /** Email the quotation summary to the customer (or an explicit recipient). */
  async email(id: string, to: string | undefined, message: string | undefined, userId?: string) {
    const quote = await this.get(id);
    const recipient = to || quote.customer.email;
    if (!recipient) throw new BadRequestException('Customer has no email address — provide a recipient');

    const rows = quote.items.map((i) =>
      `<tr><td>${esc(i.service.name)}</td><td>${esc(i.description ?? '')}</td><td align="right">${Number(i.quantity)}</td><td align="right">${Number(i.unitSell).toFixed(2)}</td><td align="right">${Number(i.totalSell).toFixed(2)}</td></tr>`,
    ).join('');
    const html = `
      <p>Dear ${esc(quote.customer.companyName)},</p>
      ${message ? `<p>${esc(message)}</p>` : ''}
      <p>Please find our quotation <strong>${esc(quote.quoteNumber)}</strong> below${quote.validityDate ? ` (valid until ${quote.validityDate.toISOString().slice(0, 10)})` : ''}:</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <tr><th>Service</th><th>Description</th><th>Qty</th><th>Unit (${esc(quote.currency)})</th><th>Total (${esc(quote.currency)})</th></tr>
        ${rows}
        <tr><td colspan="4" align="right"><strong>Grand Total</strong></td><td align="right"><strong>${Number(quote.sellingPrice).toFixed(2)}</strong></td></tr>
      </table>
      <p>${quote.salesPerson ? `Regards,<br/>${esc(quote.salesPerson.fullName)}` : 'Regards'}</p>`;

    const result = await this.mail.send(recipient, `Quotation ${quote.quoteNumber}`, html);
    await this.audit.log({ userId, action: 'EMAIL', entityType: 'quotation', entityId: id, detail: { to: recipient, simulated: result.simulated } });
    return { ...result, to: recipient };
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
    const approvalStatus = await this.approvalStatusFor(totals.sellingPrice, currency);

    const quote = await this.prisma.quotation.create({
      data: {
        quoteNumber,
        approvalStatus,
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
        subject: dto.subject,
        yourRef: dto.yourRef,
        attn: dto.attn,
        pol: dto.pol,
        pod: dto.pod,
        shipmentType: dto.shipmentType,
        goods: dto.goods,
        shippingTerm: dto.shippingTerm,
        paymentTerm: dto.paymentTerm,
        items: { create: items.map(({ _result, ...item }) => item) },
      },
      include: { items: true },
    });
    if (approvalStatus === 'PENDING') await this.notifyPendingApproval(quote.id, quoteNumber);
    await this.audit.log({ userId, action: 'CREATE', entityType: 'quotation', entityId: quote.id, detail: { quoteNumber, approvalStatus } });
    return quote;
  }

  /** Version history: prior snapshots of a quotation's terms, newest first. */
  async revisions(id: string) {
    const exists = await this.prisma.quotation.findFirst({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Quotation not found');
    return this.prisma.quotationRevision.findMany({
      where: { quotationId: id },
      orderBy: { revision: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });
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
      // Snapshot the terms a customer has already seen before overwriting them.
      // Only SENT quotes need this — a DRAFT was never shared. The snapshot
      // captures the full header + line items as they stand right now.
      if (existing.status === 'SENT') {
        const priorItems = await tx.quotationItem.findMany({ where: { quotationId: id }, orderBy: { sortOrder: 'asc' } });
        const last = await tx.quotationRevision.findFirst({ where: { quotationId: id }, orderBy: { revision: 'desc' }, select: { revision: true } });
        await tx.quotationRevision.create({
          data: {
            quotationId: id,
            revision: (last?.revision ?? 0) + 1,
            status: existing.status,
            sellingPrice: existing.sellingPrice,
            grossProfit: existing.grossProfit,
            snapshot: JSON.parse(JSON.stringify({ header: existing, items: priorItems })),
            createdById: userId,
          },
        });
      }
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
            taxExempt: i.taxExempt,
          }));
      const totals = computeQuotation(currentItems, charges);
      // Any edit re-evaluates approval: a previously APPROVED quote whose
      // price changed must go through review again, and one that dropped
      // below the threshold is released.
      const approvalStatus = await this.approvalStatusFor(totals.sellingPrice, currency);
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
          subject: dto.subject ?? existing.subject,
          yourRef: dto.yourRef ?? existing.yourRef,
          attn: dto.attn ?? existing.attn,
          pol: dto.pol ?? existing.pol,
          pod: dto.pod ?? existing.pod,
          shipmentType: dto.shipmentType ?? existing.shipmentType,
          goods: dto.goods ?? existing.goods,
          shippingTerm: dto.shippingTerm ?? existing.shippingTerm,
          paymentTerm: dto.paymentTerm ?? existing.paymentTerm,
          approvalStatus,
          approvedById: null,
          approvedAt: null,
          approvalNote: null,
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      const ctx = requestContext.getStore();
      await tx.auditLog.create({ data: { userId, action: 'UPDATE', entityType: 'quotation', entityId: id, ip: ctx?.ip, userAgent: ctx?.userAgent } });
      return quote;
    }).then(async (quote) => {
      if (quote.approvalStatus === 'PENDING') await this.notifyPendingApproval(quote.id, quote.quoteNumber);
      return quote;
    });
  }

  async setStatus(id: string, status: 'DRAFT' | 'SENT' | 'WON' | 'LOST' | 'CANCELLED', userId?: string) {
    const existing = await this.prisma.quotation.findUnique({ where: { id }, select: { status: true, approvalStatus: true } });
    if (!existing) throw new NotFoundException('Quotation not found');
    assertQuotationStatusTransition(existing.status, status);
    if (status === 'SENT' || status === 'WON') assertApprovalAllows(status, existing.approvalStatus);
    const quote = await this.prisma.quotation.update({ where: { id }, data: { status } });
    await this.audit.log({ userId, action: 'STATUS', entityType: 'quotation', entityId: id, detail: { from: existing.status, to: status } });
    return quote;
  }

  /** Approve a PENDING quotation (approvals.write). */
  async approve(id: string, note: string | undefined, userId: string) {
    const existing = await this.prisma.quotation.findFirst({ where: { id, deletedAt: null }, select: { approvalStatus: true, quoteNumber: true } });
    if (!existing) throw new NotFoundException('Quotation not found');
    if (existing.approvalStatus !== 'PENDING') {
      throw new BadRequestException(`Quotation is ${existing.approvalStatus}, not awaiting approval`);
    }
    const quote = await this.prisma.quotation.update({
      where: { id },
      data: { approvalStatus: 'APPROVED', approvedById: userId, approvedAt: new Date(), approvalNote: note ?? null },
    });
    await this.audit.log({ userId, action: 'APPROVE', entityType: 'quotation', entityId: id, detail: { quoteNumber: existing.quoteNumber, note } });
    return quote;
  }

  /** Reject a PENDING quotation; revising the quote re-triggers approval. */
  async reject(id: string, note: string | undefined, userId: string) {
    const existing = await this.prisma.quotation.findFirst({ where: { id, deletedAt: null }, select: { approvalStatus: true, quoteNumber: true } });
    if (!existing) throw new NotFoundException('Quotation not found');
    if (existing.approvalStatus !== 'PENDING') {
      throw new BadRequestException(`Quotation is ${existing.approvalStatus}, not awaiting approval`);
    }
    const quote = await this.prisma.quotation.update({
      where: { id },
      data: { approvalStatus: 'REJECTED', approvedById: userId, approvedAt: new Date(), approvalNote: note ?? null },
    });
    await this.audit.log({ userId, action: 'REJECT', entityType: 'quotation', entityId: id, detail: { quoteNumber: existing.quoteNumber, note } });
    return quote;
  }

  /** Quotation → Job conversion (automation). Marks the quote WON and copies commercials. */
  async convertToJob(id: string, userId?: string) {
    const quote = await this.get(id);
    // Conversion implies a WON transition; the state machine is the single
    // source of truth for which statuses may reach WON (blocks CANCELLED/LOST).
    assertQuotationStatusTransition(quote.status, 'WON');
    assertApprovalAllows('WON', quote.approvalStatus);
    // One quotation converts to at most one job. Fail fast with a friendly
    // message; the DB unique constraint below is the race-safe backstop.
    const existingJob = await this.prisma.job.findUnique({
      where: { quotationId: id },
      select: { jobNumber: true },
    });
    if (existingJob) {
      throw new ConflictException(`Quotation already converted to job ${existingJob.jobNumber}`);
    }
    const jobNumber = await this.seq.next('job');
    // Primary vendor: the one carrying the largest cost share
    const vendorTotals = new Map<string, number>();
    for (const item of quote.items) {
      if (item.vendorId) vendorTotals.set(item.vendorId, (vendorTotals.get(item.vendorId) ?? 0) + Number(item.totalCost));
    }
    const primaryVendorId = [...vendorTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const j = await tx.job.create({
          data: {
            jobNumber,
            customerId: quote.customerId,
            quotationId: quote.id,
            vendorId: primaryVendorId,
            currency: quote.currency,
            actualCost: quote.totalCost,
            // Net of SST: sellingPrice is the tax-inclusive grand total, but
            // collected tax is not revenue. Keeps actualRevenue − actualCost
            // equal to profit, and the job-based P&L consistent with the
            // quotation-based P&L (which already reports net of tax).
            actualRevenue: Number(quote.sellingPrice) - Number(quote.taxAmt),
            profit: quote.grossProfit,
            // Carry the freight lane onto the job so ops sees it without
            // opening the source quotation.
            origin: quote.pol,
            destination: quote.pod,
            status: 'OPEN',
          },
        });
        if (quote.status !== 'WON') await tx.quotation.update({ where: { id }, data: { status: 'WON' } });
        const ctx = requestContext.getStore();
        await tx.auditLog.create({ data: { userId, action: 'CONVERT', entityType: 'quotation', entityId: id, detail: { jobNumber }, ip: ctx?.ip, userAgent: ctx?.userAgent } });
        return j;
      });
    } catch (e) {
      // Concurrent double-submit: the unique constraint on quotationId fired.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Quotation was already converted to a job');
      }
      throw e;
    }
  }

  /** Soft delete — moves the quotation to the recycle bin, restorable. */
  async remove(id: string, userId?: string) {
    const existing = await this.prisma.quotation.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Quotation not found');
    await this.prisma.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'quotation', entityId: id });
    return { deleted: true };
  }
}
