import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { MailService } from '../../common/mail.service';
import { PrismaService } from '../../common/prisma.service';
import { requestContext } from '../../common/request-context';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { assertInvoiceStatusTransition } from '../../common/state-machine';
import { applyPayment, computeTotals, round2 as r2, OverpaymentError, NonPositivePaymentError } from './invoice.calc';
import { CreateInvoiceDto, RecordPaymentDto, UpdateInvoiceDto } from './invoices.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private audit: AuditService,
    private mail: MailService,
  ) {}

  /** Email the invoice summary to the customer (or an explicit recipient). */
  async email(id: string, to: string | undefined, message: string | undefined, userId?: string) {
    const inv = await this.get(id);
    if (inv.status === 'DRAFT') throw new BadRequestException('Issue the invoice before emailing it');
    const recipient = to || inv.customer.email;
    if (!recipient) throw new BadRequestException('Customer has no email address — provide a recipient');

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const balance = (Number(inv.totalAmount) - Number(inv.amountPaid)).toFixed(2);
    const html = `
      <p>Dear ${esc(inv.customer.companyName)},</p>
      ${message ? `<p>${esc(message)}</p>` : ''}
      <p>Please find the details of invoice <strong>${esc(inv.invoiceNumber)}</strong>:</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <tr><td>Issue Date</td><td>${inv.issueDate.toISOString().slice(0, 10)}</td></tr>
        ${inv.dueDate ? `<tr><td>Due Date</td><td>${inv.dueDate.toISOString().slice(0, 10)}</td></tr>` : ''}
        ${inv.job ? `<tr><td>Job</td><td>${esc(inv.job.jobNumber)}</td></tr>` : ''}
        <tr><td>Subtotal</td><td align="right">${esc(inv.currency)} ${Number(inv.subtotal).toFixed(2)}</td></tr>
        <tr><td>Tax</td><td align="right">${esc(inv.currency)} ${Number(inv.taxAmt).toFixed(2)}</td></tr>
        <tr><td><strong>Total</strong></td><td align="right"><strong>${esc(inv.currency)} ${Number(inv.totalAmount).toFixed(2)}</strong></td></tr>
        <tr><td>Paid</td><td align="right">${esc(inv.currency)} ${Number(inv.amountPaid).toFixed(2)}</td></tr>
        <tr><td><strong>Balance Due</strong></td><td align="right"><strong>${esc(inv.currency)} ${balance}</strong></td></tr>
      </table>
      <p>Regards</p>`;

    const result = await this.mail.send(recipient, `Invoice ${inv.invoiceNumber}`, html);
    await this.audit.log({ userId, action: 'EMAIL', entityType: 'invoice', entityId: id, detail: { to: recipient, simulated: result.simulated } });
    return { ...result, to: recipient };
  }

  /** subtotal + tax, computed server-side so the client can't send an arbitrary total. */
  private totals(subtotal: number, taxPct: number) {
    return computeTotals(subtotal, taxPct);
  }

  async list(dto: PaginationDto & { status?: string; customerId?: string; jobId?: string }) {
    const where: Prisma.InvoiceWhereInput = {};
    if (dto.search) {
      where.OR = [
        { invoiceNumber: { contains: dto.search, mode: 'insensitive' } },
        { customer: { companyName: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }
    if (dto.status) where.status = dto.status as never;
    if (dto.customerId) where.customerId = dto.customerId;
    if (dto.jobId) where.jobId = dto.jobId;
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { customer: { select: { companyName: true, code: true } }, job: { select: { jobNumber: true } } },
        orderBy: { issueDate: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paged(items, total, dto);
  }

  async get(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        job: { select: { jobNumber: true, origin: true, destination: true } },
        payments: { orderBy: { paidAt: 'desc' }, include: { recordedBy: { select: { fullName: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(dto: CreateInvoiceDto, userId?: string) {
    const invoiceNumber = await this.seq.next('invoice');
    const taxPct = dto.taxPct ?? 0;
    const { taxAmt, totalAmount } = this.totals(dto.subtotal, taxPct);
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        customerId: dto.customerId,
        jobId: dto.jobId,
        currency: dto.currency || 'MYR',
        subtotal: dto.subtotal,
        taxPct,
        taxAmt,
        totalAmount,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'invoice', entityId: invoice.id, detail: { invoiceNumber } });
    return invoice;
  }

  /**
   * Generate a DRAFT invoice from a completed job, pulling the amount straight
   * from the job's actual revenue and currency so there's no manual re-keying
   * (and no mismatch between the work done and what gets billed). Guards
   * against billing the same job twice.
   */
  async generateFromJob(jobId: string, userId?: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, deletedAt: null },
      select: {
        id: true, jobNumber: true, customerId: true, currency: true, actualRevenue: true, status: true,
        quotation: { select: { taxPct: true, taxAmt: true } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (Number(job.actualRevenue) <= 0) {
      throw new BadRequestException('Job has no actual revenue to invoice — set the job revenue first');
    }
    const existing = await this.prisma.invoice.findFirst({
      where: { jobId, status: { not: 'CANCELLED' } },
      select: { invoiceNumber: true },
    });
    if (existing) {
      throw new ConflictException(`Job ${job.jobNumber} is already invoiced (${existing.invoiceNumber})`);
    }
    // actualRevenue is net of SST. Carry the source quotation's ACTUAL tax
    // amount rather than recomputing subtotal × taxPct — the quote's tax base
    // excludes SST-exempt lines (ocean freight), so a flat percentage would
    // overbill. Manually-created jobs (no quotation) stay untaxed here and
    // the draft can be edited before issuing.
    const subtotal = Number(job.actualRevenue);
    const taxAmt = Number(job.quotation?.taxAmt ?? 0);
    const taxPct = Number(job.quotation?.taxPct ?? 0);
    const totalAmount = subtotal + taxAmt;
    const invoiceNumber = await this.seq.next('invoice');
    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        jobId: job.id,
        customerId: job.customerId,
        currency: job.currency,
        subtotal,
        taxPct,
        taxAmt,
        totalAmount,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'invoice', entityId: invoice.id, detail: { invoiceNumber, fromJob: job.jobNumber } });
    return invoice;
  }

  /** Only DRAFT invoices are editable — once ISSUED the commercial trail is locked. */
  async update(id: string, dto: UpdateInvoiceDto, userId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Invoice not found');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot edit a ${existing.status} invoice`);
    }
    const subtotal = dto.subtotal ?? Number(existing.subtotal);
    const taxPct = dto.taxPct ?? Number(existing.taxPct);
    const { taxAmt, totalAmount } = this.totals(subtotal, taxPct);
    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: {
        customerId: dto.customerId,
        jobId: dto.jobId,
        currency: dto.currency,
        subtotal,
        taxPct,
        taxAmt,
        totalAmount,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
      },
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'invoice', entityId: id });
    return invoice;
  }

  /**
   * Days until due, derived from the customer's payment term. "NET 30" -> 30,
   * cash-like terms -> due immediately, anything else -> 30-day default.
   */
  private dueDaysFromTerm(paymentTerm: string | null | undefined): number {
    if (!paymentTerm) return 30;
    const net = /net\s*(\d+)/i.exec(paymentTerm);
    if (net) return Number(net[1]);
    if (/cash|cod|immediate/i.test(paymentTerm)) return 0;
    return 30;
  }

  async issue(id: string, userId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id }, include: { customer: { select: { paymentTerm: true } } } });
    if (!existing) throw new NotFoundException('Invoice not found');
    assertInvoiceStatusTransition(existing.status, 'ISSUED');
    // An issued invoice must carry a due date or the AR aging report can
    // never age it — default from the customer's payment term when the user
    // didn't set one explicitly on the draft.
    const dueDate = existing.dueDate
      ?? new Date(Date.now() + this.dueDaysFromTerm(existing.customer?.paymentTerm) * 86400000);
    const invoice = await this.prisma.invoice.update({ where: { id }, data: { status: 'ISSUED', dueDate } });
    await this.audit.log({ userId, action: 'STATUS', entityType: 'invoice', entityId: id, detail: { from: existing.status, to: 'ISSUED' } });
    return invoice;
  }

  async cancel(id: string, userId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Invoice not found');
    if (Number(existing.amountPaid) > 0) {
      throw new ConflictException('Cannot cancel an invoice with recorded payments — reverse the payments first');
    }
    assertInvoiceStatusTransition(existing.status, 'CANCELLED');
    const invoice = await this.prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ userId, action: 'STATUS', entityType: 'invoice', entityId: id, detail: { from: existing.status, to: 'CANCELLED' } });
    return invoice;
  }

  /** Record a payment; recomputes amountPaid and auto-derives PARTIALLY_PAID / PAID. */
  async recordPayment(id: string, dto: RecordPaymentDto, userId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Invoice not found');
    if (existing.status !== 'ISSUED' && existing.status !== 'PARTIALLY_PAID') {
      throw new BadRequestException(`Cannot record a payment on a ${existing.status} invoice`);
    }
    let newAmountPaid: number;
    let newStatus: 'PARTIALLY_PAID' | 'PAID';
    try {
      ({ newAmountPaid, newStatus } = applyPayment(Number(existing.totalAmount), Number(existing.amountPaid), dto.amount));
    } catch (e) {
      if (e instanceof OverpaymentError || e instanceof NonPositivePaymentError) throw new BadRequestException(e.message);
      throw e;
    }
    assertInvoiceStatusTransition(existing.status, newStatus);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId: id,
          amount: dto.amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          method: dto.method,
          reference: dto.reference,
          recordedById: userId,
        },
      });
      await tx.invoice.update({ where: { id }, data: { amountPaid: newAmountPaid, status: newStatus } });
      const ctx = requestContext.getStore();
      await tx.auditLog.create({
        data: { userId, action: 'PAYMENT', entityType: 'invoice', entityId: id, detail: { amount: dto.amount, newAmountPaid, newStatus }, ip: ctx?.ip, userAgent: ctx?.userAgent },
      });
      return payment;
    });
  }

  /** Aging report: outstanding balance of ISSUED/PARTIALLY_PAID invoices, bucketed by days overdue. */
  async agingReport() {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      include: { customer: { select: { companyName: true, code: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const now = new Date();
    const bucketOf = (daysOverdue: number) => {
      if (daysOverdue <= 0) return 'Current';
      if (daysOverdue <= 30) return '1-30';
      if (daysOverdue <= 60) return '31-60';
      if (daysOverdue <= 90) return '61-90';
      return '90+';
    };
    const rows = invoices.map((inv) => {
      const balance = r2(Number(inv.totalAmount) - Number(inv.amountPaid));
      const daysOverdue = inv.dueDate ? Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000) : -1;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer.companyName,
        currency: inv.currency,
        balance,
        dueDate: inv.dueDate,
        daysOverdue,
        bucket: bucketOf(daysOverdue),
      };
    });
    const bucketOrder = ['Current', '1-30', '31-60', '61-90', '90+'];
    const buckets = bucketOrder.map((label) => {
      const inBucket = rows.filter((r) => r.bucket === label);
      return { label, count: inBucket.length, total: r2(inBucket.reduce((s, r) => s + r.balance, 0)) };
    });
    return { rows, buckets, totalOutstanding: r2(rows.reduce((s, r) => s + r.balance, 0)) };
  }
}
