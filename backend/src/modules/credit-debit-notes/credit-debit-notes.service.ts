import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { assertNoteStatusTransition } from '../../common/state-machine';
import { computeNoteTotals, assertWithinCreditable, OverCreditError } from './credit-debit-note.calc';
import { CreateNoteDto, NoteItemDto, UpdateNoteDto } from './credit-debit-notes.dto';

@Injectable()
export class CreditDebitNotesService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private audit: AuditService,
  ) {}

  /** Persist-ready line rows from priced DTO items. */
  private buildItems(items: NoteItemDto[]) {
    const totals = computeNoteTotals(
      items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt })),
      0, // taxPct applied at note level below
    );
    const rows = items.map((it, i) => ({
      description: it.description,
      unitPrice: it.unitPrice,
      unit: it.unit ?? null,
      quantity: it.quantity,
      lineCurrency: it.lineCurrency || 'MYR',
      fxRate: it.fxRate ?? 1,
      amount: totals.priced[i].amount,
      taxExempt: it.taxExempt ?? false,
      accNo: it.accNo ?? null,
      sortOrder: i + 1,
    }));
    return rows;
  }

  /** Sum of ISSUED credit notes already raised against an invoice. */
  private async issuedCreditTotal(invoiceId: string, excludeNoteId?: string): Promise<number> {
    const agg = await this.prisma.creditDebitNote.aggregate({
      where: { invoiceId, type: 'CREDIT', status: 'ISSUED', ...(excludeNoteId ? { id: { not: excludeNoteId } } : {}) },
      _sum: { totalAmount: true },
    });
    return Number(agg._sum.totalAmount ?? 0);
  }

  async list(dto: PaginationDto & { type?: string; status?: string }) {
    const where: Prisma.CreditDebitNoteWhereInput = {};
    if (dto.type) where.type = dto.type as never;
    if (dto.status) where.status = dto.status as never;
    if (dto.search) {
      where.OR = [
        { noteNumber: { contains: dto.search, mode: 'insensitive' } },
        { customer: { companyName: { contains: dto.search, mode: 'insensitive' } } },
        { invoice: { invoiceNumber: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.creditDebitNote.findMany({
        where,
        include: { customer: { select: { companyName: true, code: true } }, invoice: { select: { invoiceNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.creditDebitNote.count({ where }),
    ]);
    return paged(items, total, dto);
  }

  async get(id: string) {
    const note = await this.prisma.creditDebitNote.findUnique({
      where: { id },
      include: {
        customer: true,
        invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, currency: true } },
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  /** Prefill DTO shape from an invoice's lines (client turns it into a create). */
  async fromInvoice(invoiceId: string, type: 'CREDIT' | 'DEBIT') {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: { orderBy: { sortOrder: 'asc' } }, customer: { select: { id: true, companyName: true } } },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return {
      type,
      invoiceId: inv.id,
      customerId: inv.customerId,
      currency: inv.currency,
      taxPct: Number(inv.taxPct),
      reason: '',
      items: inv.items.map((i) => ({
        description: i.description, unitPrice: Number(i.unitPrice), unit: i.unit, quantity: Number(i.quantity),
        lineCurrency: i.lineCurrency, fxRate: Number(i.fxRate), taxExempt: i.taxExempt, accNo: i.accNo,
      })),
    };
  }

  async create(dto: CreateNoteDto, userId?: string) {
    // CREDIT must reference an invoice; DEBIT may be standalone but then needs a customer.
    let invoice = null as null | { id: string; customerId: string; currency: string; status: string; totalAmount: Prisma.Decimal; amountPaid: Prisma.Decimal };
    if (dto.invoiceId) {
      invoice = await this.prisma.invoice.findUnique({
        where: { id: dto.invoiceId },
        select: { id: true, customerId: true, currency: true, status: true, totalAmount: true, amountPaid: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'CANCELLED') throw new ConflictException('Cannot raise a note against a cancelled invoice');
    } else if (dto.type === 'CREDIT') {
      throw new BadRequestException('A credit note must reference an invoice');
    }

    const customerId = invoice?.customerId ?? dto.customerId;
    if (!customerId) throw new BadRequestException('customerId is required for a standalone debit note');
    // An invoice-linked note is always in the invoice currency — the guard
    // and the aging netting subtract raw amounts, so a currency mismatch
    // would corrupt both. Only standalone notes may choose a currency.
    const currency = invoice ? invoice.currency : dto.currency || 'MYR';
    const taxPct = dto.taxPct ?? 0;

    const rows = this.buildItems(dto.items);
    const totals = computeNoteTotals(dto.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt })), taxPct);

    // Over-credit guard is enforced at ISSUE time (a draft may be over-limit
    // while being edited), but reject an obviously-impossible draft early too
    // when the invoice is known.
    if (dto.type === 'CREDIT' && invoice) {
      const already = await this.issuedCreditTotal(invoice.id);
      try {
        assertWithinCreditable(totals.totalAmount, Number(invoice.totalAmount), already, Number(invoice.amountPaid));
      } catch (e) {
        if (e instanceof OverCreditError) throw new BadRequestException(e.message);
        throw e;
      }
    }

    const key = dto.type === 'CREDIT' ? 'creditNote' : 'debitNote';
    const noteNumber = await this.seq.next(key);
    const note = await this.prisma.creditDebitNote.create({
      data: {
        noteNumber,
        type: dto.type,
        invoiceId: invoice?.id ?? null,
        customerId,
        currency,
        subtotal: totals.subtotal,
        taxPct,
        taxAmt: totals.taxAmt,
        totalAmount: totals.totalAmount,
        reason: dto.reason,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        notes: dto.notes,
        createdById: userId ?? null,
        updatedById: userId ?? null,
        items: { create: rows },
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'creditDebitNote', entityId: note.id, detail: { noteNumber, type: dto.type } });
    return note;
  }

  /** Only DRAFT notes are editable — once ISSUED the document is locked. */
  async update(id: string, dto: UpdateNoteDto, userId?: string) {
    const existing = await this.prisma.creditDebitNote.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Note not found');
    if (existing.status !== 'DRAFT') throw new BadRequestException(`Cannot edit a ${existing.status} note`);

    const taxPct = dto.taxPct ?? Number(existing.taxPct);
    const built = dto.items ? this.buildItems(dto.items) : null;
    const totals = dto.items
      ? computeNoteTotals(dto.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt })), taxPct)
      : null;

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.creditDebitNoteItem.deleteMany({ where: { noteId: id } });
        if (built!.length) await tx.creditDebitNoteItem.createMany({ data: built!.map((r) => ({ ...r, noteId: id })) });
      }
      const note = await tx.creditDebitNote.update({
        where: { id },
        data: {
          // Invoice-linked notes stay in the invoice currency (see create()).
          currency: existing.invoiceId ? undefined : dto.currency,
          taxPct,
          reason: dto.reason,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          notes: dto.notes,
          ...(totals ? { subtotal: totals.subtotal, taxAmt: totals.taxAmt, totalAmount: totals.totalAmount } : {}),
          updatedById: userId ?? null,
        },
      });
      await this.audit.log({ userId, action: 'UPDATE', entityType: 'creditDebitNote', entityId: id });
      return note;
    });
  }

  /**
   * DRAFT → ISSUED: lock the document and (for credit notes) enforce the
   * over-credit guard. Runs in one transaction with the invoice row locked
   * (M2) so two concurrent issues cannot both pass the guard, and stamps the
   * SST tax-point date (M3): a draft that was auto-dated at creation gets
   * today's date when it is actually posted; an explicitly chosen document
   * date is preserved.
   */
  async issue(id: string, userId?: string) {
    const note = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.creditDebitNote.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Note not found');
      assertNoteStatusTransition(existing.status, 'ISSUED');

      if (existing.type === 'CREDIT' && existing.invoiceId) {
        // M2: serialize concurrent issues against the same invoice — the row
        // lock makes guard-check + status-write atomic (same FOR UPDATE
        // pattern as sequence.service.ts).
        const locked = await tx.$queryRaw<{ totalAmount: unknown; amountPaid: unknown }[]>`
          SELECT "totalAmount", "amountPaid" FROM invoices WHERE id = ${existing.invoiceId} FOR UPDATE`;
        const inv = locked[0];
        const agg = await tx.creditDebitNote.aggregate({
          where: { invoiceId: existing.invoiceId, type: 'CREDIT', status: 'ISSUED', id: { not: id } },
          _sum: { totalAmount: true },
        });
        try {
          assertWithinCreditable(
            Number(existing.totalAmount),
            Number(inv?.totalAmount ?? 0),
            Number(agg._sum.totalAmount ?? 0),
            Number(inv?.amountPaid ?? 0),
          );
        } catch (e) {
          if (e instanceof OverCreditError) throw new BadRequestException(e.message);
          throw e;
        }
      }

      // M3: an issueDate within a few seconds of createdAt is the creation
      // default (nobody types a to-the-second timestamp) — restamp it to the
      // actual posting time. A user-chosen date (a date-picker value) differs
      // from createdAt and is kept.
      const wasAutoDated = Math.abs(existing.issueDate.getTime() - existing.createdAt.getTime()) < 5_000;
      return tx.creditDebitNote.update({
        where: { id },
        data: { status: 'ISSUED', updatedById: userId ?? null, ...(wasAutoDated ? { issueDate: new Date() } : {}) },
      });
    });
    await this.audit.log({ userId, action: 'STATUS', entityType: 'creditDebitNote', entityId: id, detail: { from: 'DRAFT', to: 'ISSUED' } });
    return note;
  }

  async cancel(id: string, userId?: string) {
    const existing = await this.prisma.creditDebitNote.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Note not found');
    assertNoteStatusTransition(existing.status, 'CANCELLED');
    const note = await this.prisma.creditDebitNote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ userId, action: 'STATUS', entityType: 'creditDebitNote', entityId: id, detail: { from: existing.status, to: 'CANCELLED' } });
    return note;
  }
}
