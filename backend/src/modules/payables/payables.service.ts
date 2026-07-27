import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { paged } from '../../common/dto/pagination.dto';
import {
  assertVendorBillReversal, assertVendorBillStatusTransition, VendorBillStatus,
} from '../../common/state-machine';
import { NonPositivePaymentError, OverpaymentError, round2 as r2 } from '../invoices/invoice.calc';
import {
  applyVendorPayment, computeVendorBillTotals, LIVE_PAYABLE_STATUSES,
  outstandingOfBill, recomputeAfterReversal,
} from './vendor-bill.calc';
import {
  CreateVendorBillDto, ListPayablesDto, RecordVendorPaymentDto,
  ReverseVendorPaymentDto, UpdateVendorBillDto, VendorBillItemDto,
} from './payables.dto';

/**
 * Accounts Payable. A vendor bill is our record of one invoice issued to us by
 * one vendor; once APPROVED it is a payable that appears in AP aging.
 *
 * Ownership boundary (AP_ARCHITECTURE_DECISION.md §4): this service NEVER
 * writes Job.actualCost, Job.profit or Job.actualRevenue. Job allocation is
 * stored for reporting only; billed totals are always DERIVED, never stored.
 */
@Injectable()
export class PayablesService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private audit: AuditService,
    private fx: FxService,
  ) {}

  /** Persist-ready line rows from priced DTO items. */
  private buildItems(items: VendorBillItemDto[]) {
    const totals = computeVendorBillTotals(
      items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt })),
      0, // taxPct applied at bill level
    );
    return items.map((it, i) => ({
      description: it.description,
      unitPrice: it.unitPrice,
      unit: it.unit ?? null,
      quantity: it.quantity,
      lineCurrency: it.lineCurrency || 'MYR',
      fxRate: it.fxRate ?? 1,
      amount: totals.priced[i].amount,
      taxExempt: it.taxExempt ?? false,
      accNo: it.accNo ?? null,
      jobId: it.jobId ?? null,
      sortOrder: i + 1,
    }));
  }

  /** Guards that a referenced job exists and is not in the recycle bin. */
  private async assertJobsExist(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return;
    const found = await this.prisma.job.findMany({ where: { id: { in: unique }, deletedAt: null }, select: { id: true } });
    if (found.length !== unique.length) throw new NotFoundException('One or more referenced jobs do not exist');
  }

  /** Duplicate control: (vendorId, vendorInvoiceNo) is unique per vendor. */
  private async assertNoDuplicate(vendorId: string, vendorInvoiceNo: string, excludeBillId?: string) {
    const clash = await this.prisma.vendorBill.findFirst({
      where: { vendorId, vendorInvoiceNo, ...(excludeBillId ? { id: { not: excludeBillId } } : {}) },
      select: { billNumber: true },
    });
    if (clash) {
      throw new ConflictException(`Invoice ${vendorInvoiceNo} has already been recorded for this vendor as ${clash.billNumber}`);
    }
  }

  async list(dto: ListPayablesDto) {
    const where: Prisma.VendorBillWhereInput = {};
    if (dto.status) where.status = dto.status as never;
    if (dto.vendorId) where.vendorId = dto.vendorId;
    if (dto.jobId) {
      // A bill counts for a job when the header points at it OR any line does.
      where.OR = [{ jobId: dto.jobId }, { items: { some: { jobId: dto.jobId } } }];
    }
    if (dto.search) {
      const search = dto.search;
      const searchOr: Prisma.VendorBillWhereInput[] = [
        { billNumber: { contains: search, mode: 'insensitive' } },
        { vendorInvoiceNo: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
      ];
      where.AND = [...(where.OR ? [{ OR: where.OR }] : []), { OR: searchOr }];
      delete where.OR;
    }
    const [items, total] = await Promise.all([
      this.prisma.vendorBill.findMany({
        where,
        include: { vendor: { select: { name: true, code: true } }, job: { select: { jobNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.vendorBill.count({ where }),
    ]);
    const rows = items.map((b) => ({
      ...b,
      outstanding: outstandingOfBill({
        totalAmount: Number(b.totalAmount), amountPaid: Number(b.amountPaid), status: b.status as VendorBillStatus,
      }),
    }));
    return paged(rows, total, dto);
  }

  async get(id: string) {
    const bill = await this.prisma.vendorBill.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true, code: true, currency: true, paymentTerm: true } },
        job: { select: { id: true, jobNumber: true } },
        items: { include: { job: { select: { jobNumber: true } } }, orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!bill) throw new NotFoundException('Vendor bill not found');
    return {
      ...bill,
      outstanding: outstandingOfBill({
        totalAmount: Number(bill.totalAmount), amountPaid: Number(bill.amountPaid), status: bill.status as VendorBillStatus,
      }),
    };
  }

  async create(dto: CreateVendorBillDto, userId?: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: dto.vendorId, deletedAt: null },
      select: { id: true, name: true, currency: true, paymentTerm: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    await this.assertNoDuplicate(vendor.id, dto.vendorInvoiceNo);
    await this.assertJobsExist([dto.jobId, ...dto.items.map((i) => i.jobId)]);

    const currency = dto.currency || vendor.currency || 'MYR';
    const taxPct = dto.taxPct ?? 0;
    const rows = this.buildItems(dto.items);
    const totals = computeVendorBillTotals(
      dto.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt })),
      taxPct,
    );

    const billNumber = await this.seq.next('vendorBill');
    const bill = await this.prisma.vendorBill.create({
      data: {
        billNumber,
        vendorInvoiceNo: dto.vendorInvoiceNo,
        vendorId: vendor.id,
        jobId: dto.jobId ?? null,
        currency,
        subtotal: totals.subtotal,
        taxPct,
        taxAmt: totals.taxAmt,
        totalAmount: totals.totalAmount,
        billDate: dto.billDate ? new Date(dto.billDate) : new Date(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        terms: dto.terms ?? vendor.paymentTerm ?? null,
        notes: dto.notes,
        createdById: userId ?? null,
        updatedById: userId ?? null,
        items: { create: rows },
      },
    });
    await this.audit.log({
      userId, action: 'CREATE', entityType: 'vendorBill', entityId: bill.id,
      detail: { billNumber, vendor: vendor.name, vendorInvoiceNo: dto.vendorInvoiceNo, totalAmount: totals.totalAmount },
    });
    return bill;
  }

  /** Only DRAFT bills are editable — once APPROVED the document is locked. */
  async update(id: string, dto: UpdateVendorBillDto, userId?: string) {
    const existing = await this.prisma.vendorBill.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Vendor bill not found');
    if (existing.status !== 'DRAFT') throw new BadRequestException(`Cannot edit a ${existing.status} bill`);

    if (dto.vendorInvoiceNo && dto.vendorInvoiceNo !== existing.vendorInvoiceNo) {
      await this.assertNoDuplicate(existing.vendorId, dto.vendorInvoiceNo, id);
    }
    await this.assertJobsExist([dto.jobId, ...(dto.items ?? []).map((i) => i.jobId)]);

    const taxPct = dto.taxPct ?? Number(existing.taxPct);
    const built = dto.items ? this.buildItems(dto.items) : null;
    const totals = dto.items
      ? computeVendorBillTotals(
          dto.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt })),
          taxPct,
        )
      : null;

    const bill = await this.prisma.$transaction(async (tx) => {
      if (built) {
        await tx.vendorBillItem.deleteMany({ where: { billId: id } });
        await tx.vendorBillItem.createMany({ data: built.map((r) => ({ ...r, billId: id })) });
      }
      return tx.vendorBill.update({
        where: { id },
        data: {
          vendorInvoiceNo: dto.vendorInvoiceNo,
          jobId: dto.jobId === undefined ? undefined : dto.jobId,
          currency: dto.currency,
          taxPct,
          billDate: dto.billDate ? new Date(dto.billDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          terms: dto.terms,
          notes: dto.notes,
          updatedById: userId ?? null,
          ...(totals ? { subtotal: totals.subtotal, taxAmt: totals.taxAmt, totalAmount: totals.totalAmount } : {}),
        },
      });
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'vendorBill', entityId: id });
    return bill;
  }

  /**
   * DRAFT → APPROVED: the posting event that makes a bill a payable. Runs in
   * one transaction with the bill row locked, and re-checks duplicate control
   * inside it so two concurrent approvals cannot both post the same vendor
   * invoice number.
   */
  async approve(id: string, userId?: string) {
    const bill = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: VendorBillStatus; vendorId: string; vendorInvoiceNo: string }[]>`
        SELECT id, status, "vendorId", "vendorInvoiceNo" FROM vendor_bills WHERE id = ${id} FOR UPDATE`;
      const existing = rows[0];
      if (!existing) throw new NotFoundException('Vendor bill not found');
      assertVendorBillStatusTransition(existing.status, 'APPROVED');

      const dup = await tx.vendorBill.findFirst({
        where: {
          vendorId: existing.vendorId, vendorInvoiceNo: existing.vendorInvoiceNo,
          id: { not: id }, status: { not: 'VOID' },
        },
        select: { billNumber: true },
      });
      if (dup) {
        throw new ConflictException(`Invoice ${existing.vendorInvoiceNo} has already been recorded for this vendor as ${dup.billNumber}`);
      }

      const lineCount = await tx.vendorBillItem.count({ where: { billId: id } });
      if (lineCount === 0) throw new BadRequestException('Cannot approve a bill with no lines');

      return tx.vendorBill.update({ where: { id }, data: { status: 'APPROVED', updatedById: userId ?? null } });
    });
    await this.audit.log({
      userId, action: 'STATUS', entityType: 'vendorBill', entityId: id,
      detail: { from: 'DRAFT', to: 'APPROVED', billNumber: bill.billNumber },
    });
    return bill;
  }

  /**
   * VOID nullifies a bill. Blocked once any (non-reversed) payment exists —
   * the payments must be reversed first, which AP can actually do.
   */
  async void(id: string, reason: string | undefined, userId?: string) {
    const bill = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: VendorBillStatus }[]>`
        SELECT id, status FROM vendor_bills WHERE id = ${id} FOR UPDATE`;
      const existing = rows[0];
      if (!existing) throw new NotFoundException('Vendor bill not found');

      // Payment check first, deliberately: a bill carrying payments is
      // PARTIALLY_PAID or PAID, so the state machine would otherwise reject it
      // with a generic "cannot change status" 400. The actionable 409 — which
      // names the payments and points at reversal — is the more useful answer.
      const livePayments = await tx.vendorPayment.count({ where: { billId: id, reversedAt: null } });
      if (livePayments > 0) {
        throw new ConflictException(
          `Cannot void a bill with ${livePayments} recorded payment(s) — reverse the payment(s) first`,
        );
      }
      assertVendorBillStatusTransition(existing.status, 'VOID');
      return tx.vendorBill.update({
        where: { id },
        data: { status: 'VOID', voidReason: reason ?? null, updatedById: userId ?? null },
      });
    });
    await this.audit.log({
      userId, action: 'STATUS', entityType: 'vendorBill', entityId: id,
      detail: { to: 'VOID', reason: reason ?? null, billNumber: bill.billNumber },
    });
    return bill;
  }

  /** Record a payment; recomputes amountPaid and derives PARTIALLY_PAID / PAID. */
  async recordPayment(id: string, dto: RecordVendorPaymentDto, userId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: VendorBillStatus; totalAmount: unknown; amountPaid: unknown }[]>`
        SELECT id, status, "totalAmount", "amountPaid" FROM vendor_bills WHERE id = ${id} FOR UPDATE`;
      const existing = rows[0];
      if (!existing) throw new NotFoundException('Vendor bill not found');
      if (existing.status !== 'APPROVED' && existing.status !== 'PARTIALLY_PAID') {
        throw new BadRequestException(`Cannot record a payment on a ${existing.status} bill`);
      }

      let newAmountPaid: number;
      let newStatus: 'PARTIALLY_PAID' | 'PAID';
      try {
        ({ newAmountPaid, newStatus } = applyVendorPayment(
          Number(existing.totalAmount), Number(existing.amountPaid), dto.amount,
        ));
      } catch (e) {
        if (e instanceof OverpaymentError || e instanceof NonPositivePaymentError) throw new BadRequestException(e.message);
        throw e;
      }
      assertVendorBillStatusTransition(existing.status, newStatus);

      const payment = await tx.vendorPayment.create({
        data: {
          billId: id,
          amount: dto.amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          method: dto.method,
          reference: dto.reference,
          recordedById: userId ?? null,
        },
      });
      await tx.vendorBill.update({ where: { id }, data: { amountPaid: newAmountPaid, status: newStatus } });
      return { payment, newAmountPaid, newStatus };
    });
    await this.audit.log({
      userId, action: 'PAYMENT', entityType: 'vendorBill', entityId: id,
      detail: { amount: dto.amount, newAmountPaid: result.newAmountPaid, newStatus: result.newStatus },
    });
    return result.payment;
  }

  /**
   * Reverse a vendor payment (PO Decision 1). Soft reversal: the row is
   * preserved and flagged, never deleted, so the audit trail survives.
   * Outstanding is recomputed from the remaining non-reversed payments and the
   * status re-derived — the only operation that moves a bill backwards, guarded
   * by the dedicated reversal edge set.
   *
   * AP aging needs no recalculation step: it derives from amountPaid at query
   * time, so it is correct the moment this transaction commits.
   */
  async reversePayment(paymentId: string, dto: ReverseVendorPaymentDto, userId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.vendorPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.reversedAt) throw new BadRequestException('This payment has already been reversed');

      const rows = await tx.$queryRaw<{ id: string; status: VendorBillStatus; totalAmount: unknown; billNumber: string }[]>`
        SELECT id, status, "totalAmount", "billNumber" FROM vendor_bills WHERE id = ${payment.billId} FOR UPDATE`;
      const bill = rows[0];
      if (!bill) throw new NotFoundException('Vendor bill not found');

      await tx.vendorPayment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), reversedById: userId ?? null, reversalReason: dto.reason },
      });

      const remaining = await tx.vendorPayment.aggregate({
        where: { billId: payment.billId, reversedAt: null },
        _sum: { amount: true },
      });
      const { newAmountPaid, newStatus } = recomputeAfterReversal(
        Number(bill.totalAmount), Number(remaining._sum.amount ?? 0),
      );
      assertVendorBillReversal(bill.status, newStatus);

      await tx.vendorBill.update({ where: { id: payment.billId }, data: { amountPaid: newAmountPaid, status: newStatus } });
      return {
        billId: payment.billId, billNumber: bill.billNumber, amount: Number(payment.amount),
        previousStatus: bill.status, newAmountPaid, newStatus,
      };
    });
    await this.audit.log({
      userId, action: 'REVERSE_PAYMENT', entityType: 'vendorPayment', entityId: paymentId,
      detail: {
        billId: result.billId, billNumber: result.billNumber, amount: result.amount, reason: dto.reason,
        previousStatus: result.previousStatus, newStatus: result.newStatus, newAmountPaid: result.newAmountPaid,
      },
    });
    return result;
  }

  /**
   * Phase B — job cost variance. READ-ONLY: exposes four independent values
   * and writes nothing. Vendor bills are NOT the owner of Job.actualCost
   * (PO Decision 3), so this method compares rather than overwrites.
   *
   * - estimatedCost  the linked quotation's costed total (null without a quote)
   * - recordedCost   Job.actualCost, maintained by operations
   * - billedTotal    DERIVED: allocated lines of live vendor bills, FX-converted
   * - variance       billedTotal − recordedCost
   *
   * `recordedIsUnconfirmed` is true when the recorded cost still equals the
   * quotation estimate: at conversion the job is seeded with the quote's total
   * cost, so an untouched job's "actual" cost is really still an estimate. The
   * UI must say so rather than implying an independent measurement.
   */
  async jobCostVariance(jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, deletedAt: null },
      select: {
        id: true, jobNumber: true, currency: true, status: true, actualCost: true,
        quotation: { select: { totalCost: true, currency: true } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    // Lines allocated to this job, either directly or via their bill header.
    const lines = await this.prisma.vendorBillItem.findMany({
      where: {
        OR: [{ jobId }, { jobId: null, bill: { jobId } }],
        bill: { status: { in: LIVE_PAYABLE_STATUSES as never[] } },
      },
      select: {
        amount: true, taxExempt: true,
        bill: { select: { id: true, currency: true, taxPct: true, billDate: true } },
      },
    });

    const fx = await this.fx.converter();
    const jobCurrency = job.currency || fx.baseCurrency;
    // Convert via base currency: bill ccy -> base -> job ccy. Rates are the
    // current table values (no revaluation — PO Decision 12).
    const jobUnit = fx.toBase(1, jobCurrency) || 1;
    const toJobCcy = (amount: number, currency: string) => fx.toBase(amount, currency) / jobUnit;

    let billed = 0;
    const billIds = new Set<string>();
    let latestBillDate: Date | null = null;
    for (const l of lines) {
      const amount = Number(l.amount);
      const taxPct = Number(l.bill.taxPct);
      const lineTax = l.taxExempt ? 0 : amount * (taxPct / 100); // SST is a cost
      billed += toJobCcy(amount + lineTax, l.bill.currency);
      billIds.add(l.bill.id);
      if (!latestBillDate || l.bill.billDate > latestBillDate) latestBillDate = l.bill.billDate;
    }
    const billedTotal = r2(billed);

    const recordedCost = Number(job.actualCost);
    const estimatedCost = job.quotation ? Number(job.quotation.totalCost) : null;

    return {
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobStatus: job.status,
      currency: jobCurrency,
      estimatedCost,
      recordedCost,
      billedTotal,
      // Absent measurement and a measured zero are different facts: with no
      // bills the variance is null, never 0.00.
      variance: billIds.size > 0 ? r2(billedTotal - recordedCost) : null,
      billCount: billIds.size,
      latestBillDate,
      recordedIsUnconfirmed: estimatedCost !== null && r2(recordedCost) === r2(estimatedCost),
      // Carrier invoices routinely arrive after delivery, so "billed" is
      // structurally incomplete until the job is finished.
      billsMayBeOutstanding: job.status !== 'COMPLETED',
    };
  }

  /** AP aging: outstanding payables bucketed by days overdue, plus per-vendor totals. */
  async agingReport() {
    const bills = await this.prisma.vendorBill.findMany({
      where: { status: { in: LIVE_PAYABLE_STATUSES as never[] } },
      include: { vendor: { select: { name: true, code: true } } },
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

    const rows = bills.map((b) => {
      const outstanding = outstandingOfBill({
        totalAmount: Number(b.totalAmount), amountPaid: Number(b.amountPaid), status: b.status as VendorBillStatus,
      });
      const daysOverdue = b.dueDate ? Math.floor((now.getTime() - b.dueDate.getTime()) / 86400000) : -1;
      return {
        id: b.id,
        billNumber: b.billNumber,
        vendorInvoiceNo: b.vendorInvoiceNo,
        vendor: b.vendor.name,
        currency: b.currency,
        totalAmount: Number(b.totalAmount),
        amountPaid: Number(b.amountPaid),
        outstanding,
        dueDate: b.dueDate,
        daysOverdue,
        bucket: bucketOf(daysOverdue),
      };
    }).filter((r) => r.outstanding > 0.005);

    const bucketOrder = ['Current', '1-30', '31-60', '61-90', '90+'];
    const buckets = bucketOrder.map((label) => {
      const inBucket = rows.filter((r) => r.bucket === label);
      return { label, count: inBucket.length, total: r2(inBucket.reduce((s, r) => s + r.outstanding, 0)) };
    });

    const vendorMap = new Map<string, { vendor: string; count: number; total: number }>();
    for (const r of rows) {
      const v = vendorMap.get(r.vendor) ?? { vendor: r.vendor, count: 0, total: 0 };
      v.count += 1;
      v.total = r2(v.total + r.outstanding);
      vendorMap.set(r.vendor, v);
    }
    const byVendor = [...vendorMap.values()].sort((a, b) => b.total - a.total);

    return { rows, buckets, byVendor, totalPayable: r2(rows.reduce((s, r) => s + r.outstanding, 0)) };
  }
}
