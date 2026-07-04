import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { requestContext } from '../../common/request-context';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { assertInvoiceStatusTransition } from '../../common/state-machine';
import { CreateInvoiceDto, RecordPaymentDto, UpdateInvoiceDto } from './invoices.dto';

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private audit: AuditService,
  ) {}

  /** subtotal + tax, computed server-side so the client can't send an arbitrary total. */
  private totals(subtotal: number, taxPct: number) {
    const taxAmt = r2(subtotal * (taxPct / 100));
    return { taxAmt, totalAmount: r2(subtotal + taxAmt) };
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

  async issue(id: string, userId?: string) {
    const existing = await this.prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Invoice not found');
    assertInvoiceStatusTransition(existing.status, 'ISSUED');
    const invoice = await this.prisma.invoice.update({ where: { id }, data: { status: 'ISSUED' } });
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
    const remaining = r2(Number(existing.totalAmount) - Number(existing.amountPaid));
    if (dto.amount > remaining) {
      throw new BadRequestException(`Payment of ${dto.amount} exceeds remaining balance of ${remaining}`);
    }
    const newAmountPaid = r2(Number(existing.amountPaid) + dto.amount);
    const newStatus = newAmountPaid >= Number(existing.totalAmount) ? 'PAID' : 'PARTIALLY_PAID';
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
