import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayablesService } from './payables.service';

/**
 * Service-level tests for Accounts Payable with a stubbed Prisma (no database).
 *
 * The most important suite here is the last one: AP must never write
 * Job.actualCost, Job.profit or Job.actualRevenue (PO Decision 3 /
 * AP_ARCHITECTURE_DECISION.md §4). That boundary is asserted structurally — by
 * proving the service never touches the `job` delegate at all — rather than by
 * spot-checking values.
 */

interface World {
  bill?: Record<string, unknown> | null;
  duplicate?: { billNumber: string } | null;
  vendor?: Record<string, unknown> | null;
  jobs?: { id: string }[];
  payment?: Record<string, unknown> | null;
  remainingPaid?: number;
  lineCount?: number;
  livePayments?: number;
}

function makeService(w: World) {
  const writes: { billUpdates: Record<string, unknown>[]; paymentUpdates: Record<string, unknown>[]; created: Record<string, unknown>[] } = {
    billUpdates: [], paymentUpdates: [], created: [],
  };
  // Any call on these delegates is a boundary violation — AP must not write them.
  const forbidden = { update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), upsert: jest.fn(), delete: jest.fn() };

  const tx = {
    $queryRaw: jest.fn(async () => (w.bill ? [w.bill] : [])),
    vendorBill: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.billUpdates.push(data);
        return { ...(w.bill ?? {}), ...data, billNumber: (w.bill as { billNumber?: string })?.billNumber ?? 'BILL-2026-0001' };
      }),
      findFirst: jest.fn(async () => w.duplicate ?? null),
    },
    vendorBillItem: {
      count: jest.fn(async () => w.lineCount ?? 1),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    vendorPayment: {
      count: jest.fn(async () => w.livePayments ?? 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { writes.created.push(data); return { id: 'pay-1', ...data }; }),
      findUnique: jest.fn(async () => w.payment ?? null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { writes.paymentUpdates.push(data); return data; }),
      aggregate: jest.fn(async () => ({ _sum: { amount: w.remainingPaid ?? 0 } })),
    },
    job: forbidden,
    invoice: forbidden,
    creditDebitNote: forbidden,
  };

  const prisma = {
    ...tx,
    vendor: { findFirst: jest.fn(async () => w.vendor ?? null) },
    job: { ...forbidden, findMany: jest.fn(async () => w.jobs ?? []) },
    vendorBill: { ...tx.vendorBill, findUnique: jest.fn(async () => w.bill ?? null), findMany: jest.fn(async () => []), count: jest.fn(async () => 0), create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { writes.created.push(data); return { id: 'bill-1', ...data }; }) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const seq = { next: jest.fn(async () => 'BILL-2026-0001') };
  const audit = { log: jest.fn(async () => undefined) };
  const fx = {
    historicalConverter: jest.fn(async () => ({
      toBaseAt: (amount: number) => amount, missing: new Set<string>(), baseCurrency: 'MYR',
    })),
    warning: jest.fn(() => null),
  };
  const service = new PayablesService(prisma as never, seq as never, audit as never, fx as never);
  return { service, prisma, tx, writes, audit, forbidden };
}

const vendor = { id: 'v1', name: 'Trans-Coastal Lines', currency: 'MYR', paymentTerm: 'NET 30' };
const oneLine = [{ description: 'Ocean freight', unitPrice: 1000, quantity: 1 }];

describe('Duplicate vendor invoice protection', () => {
  it('rejects a second bill with the same invoice number for the same vendor', async () => {
    const { service } = makeService({ vendor, duplicate: { billNumber: 'BILL-2026-0001' } });
    await expect(
      service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-001', items: oneLine }),
    ).rejects.toThrow(ConflictException);
  });

  it('names the existing bill so the user can find it', async () => {
    const { service } = makeService({ vendor, duplicate: { billNumber: 'BILL-2026-0007' } });
    await expect(
      service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-001', items: oneLine }),
    ).rejects.toThrow(/already been recorded for this vendor as BILL-2026-0007/);
  });

  it('accepts the same invoice number for a different vendor (scoped, not global)', async () => {
    const { service, writes } = makeService({ vendor, duplicate: null });
    await service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-001', items: oneLine });
    expect(writes.created[0].vendorInvoiceNo).toBe('INV-001');
  });

  it('re-checks for a duplicate inside the approve transaction', async () => {
    const { service } = makeService({
      bill: { id: 'b1', status: 'DRAFT', vendorId: 'v1', vendorInvoiceNo: 'INV-001' },
      duplicate: { billNumber: 'BILL-2026-0002' },
    });
    await expect(service.approve('b1')).rejects.toThrow(ConflictException);
  });

  // Sprint 03A / H-1 — a VOID bill must release its number so the documented
  // correction workflow (create -> approve -> void -> re-enter) can run.
  it('excludes VOID bills from the duplicate check, so a voided number can be re-entered', async () => {
    const { service, prisma } = makeService({ vendor, duplicate: null });
    await service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-001', items: oneLine });
    const where = (prisma.vendorBill.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ vendorId: 'v1', vendorInvoiceNo: 'INV-001', status: { not: 'VOID' } });
  });

  it('still blocks a duplicate against a live (non-VOID) bill', async () => {
    const { service } = makeService({ vendor, duplicate: { billNumber: 'BILL-2026-0001' } });
    await expect(
      service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-001', items: oneLine }),
    ).rejects.toThrow(ConflictException);
  });

  it('applies the same VOID exclusion when editing a DRAFT bill', async () => {
    const { service, prisma } = makeService({
      bill: { id: 'b1', status: 'DRAFT', vendorId: 'v1', vendorInvoiceNo: 'INV-OLD', taxPct: 0 },
      duplicate: null,
    });
    await service.update('b1', { vendorInvoiceNo: 'INV-NEW' });
    const where = (prisma.vendorBill.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'VOID' });
  });
});

describe('Bill creation', () => {
  it('computes totals server-side and adopts the vendor currency and terms', async () => {
    const { service, writes } = makeService({ vendor, duplicate: null });
    await service.create({
      vendorId: 'v1', vendorInvoiceNo: 'INV-002', taxPct: 6,
      items: [{ description: 'THC', unitPrice: 500, quantity: 2 }],
    });
    const created = writes.created[0];
    expect(created.currency).toBe('MYR');
    expect(created.terms).toBe('NET 30');
    expect(created.subtotal).toBe(1000);
    expect(created.taxAmt).toBe(60);
    expect(created.totalAmount).toBe(1060);
    expect(created.status).toBeUndefined(); // defaults to DRAFT in the schema
  });

  it('rejects an unknown vendor', async () => {
    const { service } = makeService({ vendor: null });
    await expect(service.create({ vendorId: 'nope', vendorInvoiceNo: 'X', items: oneLine })).rejects.toThrow(NotFoundException);
  });

  it('rejects a bill referencing a job that does not exist', async () => {
    const { service } = makeService({ vendor, duplicate: null, jobs: [] });
    await expect(
      service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-003', jobId: 'ghost-job', items: oneLine }),
    ).rejects.toThrow(/referenced jobs do not exist/);
  });

  it('allows a bill with no job at all (overheads)', async () => {
    const { service, writes } = makeService({ vendor, duplicate: null });
    await service.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-004', items: oneLine });
    expect(writes.created[0].jobId).toBeNull();
  });
});

describe('Editability and approval', () => {
  it('refuses to edit a non-DRAFT bill', async () => {
    const { service } = makeService({ bill: { id: 'b1', status: 'APPROVED', vendorId: 'v1', vendorInvoiceNo: 'INV-001', taxPct: 0 } });
    await expect(service.update('b1', { notes: 'x' })).rejects.toThrow(/Cannot edit a APPROVED bill/);
  });

  it('refuses to approve a bill with no lines', async () => {
    const { service } = makeService({
      bill: { id: 'b1', status: 'DRAFT', vendorId: 'v1', vendorInvoiceNo: 'INV-001' },
      duplicate: null, lineCount: 0,
    });
    await expect(service.approve('b1')).rejects.toThrow(/no lines/);
  });

  it('locks the bill row inside the approve transaction (FOR UPDATE)', async () => {
    const { service, tx } = makeService({
      bill: { id: 'b1', status: 'DRAFT', vendorId: 'v1', vendorInvoiceNo: 'INV-001' }, duplicate: null,
    });
    await service.approve('b1');
    const sql = (tx.$queryRaw as jest.Mock).mock.calls[0][0].join('?');
    expect(sql).toContain('FOR UPDATE');
  });
});

describe('Void guards', () => {
  it('blocks voiding a bill that has live payments', async () => {
    const { service } = makeService({ bill: { id: 'b1', status: 'APPROVED' }, livePayments: 2 });
    await expect(service.void('b1', 'mistake')).rejects.toThrow(ConflictException);
    await expect(service.void('b1', 'mistake')).rejects.toThrow(/reverse the payment\(s\) first/);
  });

  // A bill carrying payments is PARTIALLY_PAID/PAID, so the state machine would
  // answer with a generic 400. The actionable 409 must win (plan AC-9).
  it('gives the actionable 409 — not the state-machine 400 — for a PAID bill', async () => {
    const { service } = makeService({ bill: { id: 'b1', status: 'PAID' }, livePayments: 1 });
    await expect(service.void('b1', 'mistake')).rejects.toThrow(ConflictException);
    await expect(service.void('b1', 'mistake')).rejects.toThrow(/reverse the payment\(s\) first/);
  });

  it('still blocks voiding a PAID bill whose payments were all reversed (state machine)', async () => {
    const { service } = makeService({ bill: { id: 'b1', status: 'PAID' }, livePayments: 0 });
    await expect(service.void('b1', 'x')).rejects.toThrow(/cannot change from PAID to VOID/);
  });

  it('allows voiding when every payment has already been reversed', async () => {
    const { service, writes } = makeService({ bill: { id: 'b1', status: 'APPROVED' }, livePayments: 0 });
    await service.void('b1', 'duplicate entry');
    expect(writes.billUpdates[0]).toMatchObject({ status: 'VOID', voidReason: 'duplicate entry' });
  });
});

describe('Payments', () => {
  it('rejects a payment on a DRAFT bill', async () => {
    const { service } = makeService({ bill: { id: 'b1', status: 'DRAFT', totalAmount: 1000, amountPaid: 0 } });
    await expect(service.recordPayment('b1', { amount: 100 })).rejects.toThrow(/Cannot record a payment on a DRAFT bill/);
  });

  it('rejects an overpayment', async () => {
    const { service } = makeService({ bill: { id: 'b1', status: 'APPROVED', totalAmount: 1000, amountPaid: 600 } });
    await expect(service.recordPayment('b1', { amount: 500 })).rejects.toThrow(BadRequestException);
  });

  it('derives PARTIALLY_PAID and writes amountPaid in the same transaction', async () => {
    const { service, writes } = makeService({ bill: { id: 'b1', status: 'APPROVED', totalAmount: 1000, amountPaid: 0 } });
    await service.recordPayment('b1', { amount: 400 });
    expect(writes.billUpdates[0]).toEqual({ amountPaid: 400, status: 'PARTIALLY_PAID' });
  });

  it('derives PAID when the balance is settled', async () => {
    const { service, writes } = makeService({ bill: { id: 'b1', status: 'PARTIALLY_PAID', totalAmount: 1000, amountPaid: 600 } });
    await service.recordPayment('b1', { amount: 400 });
    expect(writes.billUpdates[0]).toEqual({ amountPaid: 1000, status: 'PAID' });
  });
});

describe('Payment reversal (PO Decision 1)', () => {
  const paidBill = { id: 'b1', status: 'PAID', totalAmount: 1000, billNumber: 'BILL-2026-0001' };

  it('flags the payment instead of deleting it (audit trail preserved)', async () => {
    const { service, writes, tx } = makeService({
      payment: { id: 'p1', billId: 'b1', amount: 1000, reversedAt: null }, bill: paidBill, remainingPaid: 0,
    });
    await service.reversePayment('p1', { reason: 'paid the wrong vendor' });
    expect(tx.vendorPayment.update).toHaveBeenCalled();
    expect(writes.paymentUpdates[0]).toMatchObject({ reversalReason: 'paid the wrong vendor' });
    expect(writes.paymentUpdates[0].reversedAt).toBeInstanceOf(Date);
  });

  it('returns a fully-paid bill to APPROVED when the only payment is reversed', async () => {
    const { service, writes } = makeService({
      payment: { id: 'p1', billId: 'b1', amount: 1000, reversedAt: null }, bill: paidBill, remainingPaid: 0,
    });
    await service.reversePayment('p1', { reason: 'error' });
    expect(writes.billUpdates[0]).toEqual({ amountPaid: 0, status: 'APPROVED' });
  });

  it('returns it to PARTIALLY_PAID when other payments remain', async () => {
    const { service, writes } = makeService({
      payment: { id: 'p2', billId: 'b1', amount: 400, reversedAt: null }, bill: paidBill, remainingPaid: 600,
    });
    await service.reversePayment('p2', { reason: 'duplicate transfer' });
    expect(writes.billUpdates[0]).toEqual({ amountPaid: 600, status: 'PARTIALLY_PAID' });
  });

  it('refuses to reverse the same payment twice', async () => {
    const { service } = makeService({
      payment: { id: 'p1', billId: 'b1', amount: 1000, reversedAt: new Date() }, bill: paidBill,
    });
    await expect(service.reversePayment('p1', { reason: 'again' })).rejects.toThrow(/already been reversed/);
  });

  it('rejects an unknown payment', async () => {
    const { service } = makeService({ payment: null });
    await expect(service.reversePayment('ghost', { reason: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('locks the bill row and audit-logs before/after state', async () => {
    const { service, tx, audit } = makeService({
      payment: { id: 'p1', billId: 'b1', amount: 1000, reversedAt: null }, bill: paidBill, remainingPaid: 0,
    });
    await service.reversePayment('p1', { reason: 'wrong account' });
    const sql = (tx.$queryRaw as jest.Mock).mock.calls[0][0].join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REVERSE_PAYMENT',
      detail: expect.objectContaining({ previousStatus: 'PAID', newStatus: 'APPROVED', newAmountPaid: 0, reason: 'wrong account' }),
    }));
  });
});

// Phase B — job cost variance. Read-only: four independent values, never a write.
describe('Job cost variance (Phase B)', () => {
  function makeVarianceService(job: Record<string, unknown> | null, lines: unknown[], missingCurrencies?: string[]) {
    const forbidden = { update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), upsert: jest.fn(), delete: jest.fn() };
    const prisma = {
      job: { ...forbidden, findFirst: jest.fn(async () => job) },
      vendorBillItem: { findMany: jest.fn(async () => lines) },
    };
    const missing = new Set<string>(missingCurrencies ?? []);
    const fx = {
      historicalConverter: jest.fn(async () => ({
        // USD is worth 4 before 2026-06-01 and 5 from then on, so tests can
        // prove the BILL DATE selects the rate (H-2).
        toBaseAt: (a: number, c: string | undefined, on: Date) =>
          c === 'USD' ? a * (on >= new Date('2026-06-01') ? 5 : 4) : a,
        missing,
        baseCurrency: 'MYR',
      })),
      warning: jest.fn(() => (missing.size ? `No exchange rate configured to MYR for: ${[...missing].join(', ')}` : null)),
    };
    const service = new PayablesService(prisma as never, { next: jest.fn() } as never, { log: jest.fn() } as never, fx as never);
    return { service, forbidden, prisma };
  }

  const baseJob = {
    id: 'j1', jobNumber: 'JOB-2026-0001', currency: 'MYR', status: 'IN_PROGRESS',
    actualCost: 1000, quotation: { totalCost: 1000, currency: 'MYR' },
  };
  const line = (amount: number, opts: Partial<{ taxExempt: boolean; taxPct: number; currency: string; billId: string; billDate: Date }> = {}) => ({
    amount, taxExempt: opts.taxExempt ?? false,
    bill: {
      id: opts.billId ?? 'b1', currency: opts.currency ?? 'MYR', taxPct: opts.taxPct ?? 0,
      billDate: opts.billDate ?? new Date('2026-07-01'),
    },
  });

  it('reports the four values and computes variance as billed − recorded', async () => {
    const { service } = makeVarianceService(baseJob, [line(1200)]);
    const v = await service.jobCostVariance('j1');
    expect(v.estimatedCost).toBe(1000);
    expect(v.recordedCost).toBe(1000);
    expect(v.billedTotal).toBe(1200);
    expect(v.variance).toBe(200);
  });

  it('includes SST as cost on taxable lines and excludes it on exempt lines', async () => {
    const { service } = makeVarianceService(baseJob, [line(1000, { taxPct: 6 }), line(500, { taxPct: 6, taxExempt: true })]);
    const v = await service.jobCostVariance('j1');
    expect(v.billedTotal).toBe(1560); // 1000 + 60 tax + 500 exempt
  });

  it('converts a foreign-currency bill into the job currency', async () => {
    // Bill dated 2026-07-01, so the stub's post-June USD rate (5.0) applies.
    const { service } = makeVarianceService(baseJob, [line(100, { currency: 'USD' })]);
    const v = await service.jobCostVariance('j1');
    expect(v.billedTotal).toBe(500);
  });

  // Sprint 03A / H-2 — the rate is chosen by each bill's OWN date, so a
  // variance does not shift when newer rates are added.
  it('uses the rate in effect on the bill date, not the latest rate', async () => {
    const { service } = makeVarianceService(baseJob, [
      line(100, { currency: 'USD', billDate: new Date('2026-03-01') }), // pre-June rate 4.0
    ]);
    expect((await service.jobCostVariance('j1')).billedTotal).toBe(400);
  });

  it('prices two bills of the same currency at their own dates', async () => {
    const { service } = makeVarianceService(baseJob, [
      line(100, { currency: 'USD', billDate: new Date('2026-03-01'), billId: 'b1' }), // 400
      line(100, { currency: 'USD', billDate: new Date('2026-09-01'), billId: 'b2' }), // 500
    ]);
    const v = await service.jobCostVariance('j1');
    expect(v.billedTotal).toBe(900);
    expect(v.billCount).toBe(2);
  });

  it('suppresses the variance and surfaces a warning when a rate is missing', async () => {
    const { service } = makeVarianceService(baseJob, [line(100, { currency: 'EUR' })], ['EUR']);
    const v = await service.jobCostVariance('j1');
    expect(v.fxIncomplete).toBe(true);
    expect(v.fxWarning).toMatch(/No exchange rate configured to MYR for: EUR/);
    // Never present an unconverted mix as a comparable figure.
    expect(v.variance).toBeNull();
  });

  it('reports no FX warning and a real variance when every rate resolves', async () => {
    const { service } = makeVarianceService(baseJob, [line(1200)]);
    const v = await service.jobCostVariance('j1');
    expect(v.fxWarning).toBeNull();
    expect(v.fxIncomplete).toBe(false);
    expect(v.variance).toBe(200);
  });

  it('reports variance as null (not 0) when no bills are allocated', async () => {
    const { service } = makeVarianceService(baseJob, []);
    const v = await service.jobCostVariance('j1');
    expect(v.billedTotal).toBe(0);
    expect(v.variance).toBeNull();
    expect(v.billCount).toBe(0);
  });

  it('flags the recorded cost as unconfirmed while it still equals the estimate', async () => {
    const { service } = makeVarianceService(baseJob, [line(1200)]);
    expect((await service.jobCostVariance('j1')).recordedIsUnconfirmed).toBe(true);
  });

  it('clears the unconfirmed flag once operations edits the recorded cost', async () => {
    const { service } = makeVarianceService({ ...baseJob, actualCost: 1150 }, [line(1200)]);
    expect((await service.jobCostVariance('j1')).recordedIsUnconfirmed).toBe(false);
  });

  it('has no estimate and no unconfirmed flag for a job without a quotation', async () => {
    const { service } = makeVarianceService({ ...baseJob, quotation: null }, [line(500)]);
    const v = await service.jobCostVariance('j1');
    expect(v.estimatedCost).toBeNull();
    expect(v.recordedIsUnconfirmed).toBe(false);
  });

  it('counts distinct bills and warns while the job is not COMPLETED', async () => {
    const { service } = makeVarianceService(baseJob, [line(100, { billId: 'b1' }), line(200, { billId: 'b1' }), line(300, { billId: 'b2' })]);
    const v = await service.jobCostVariance('j1');
    expect(v.billCount).toBe(2);
    expect(v.billsMayBeOutstanding).toBe(true);
  });

  it('stops warning about outstanding bills once the job is COMPLETED', async () => {
    const { service } = makeVarianceService({ ...baseJob, status: 'COMPLETED' }, [line(100)]);
    expect((await service.jobCostVariance('j1')).billsMayBeOutstanding).toBe(false);
  });

  it('rejects an unknown or soft-deleted job', async () => {
    const { service } = makeVarianceService(null, []);
    await expect(service.jobCostVariance('ghost')).rejects.toThrow(NotFoundException);
  });

  it('writes nothing — the variance query is strictly read-only', async () => {
    const { service, forbidden } = makeVarianceService(baseJob, [line(1200)]);
    await service.jobCostVariance('j1');
    for (const fn of Object.values(forbidden)) expect(fn).not.toHaveBeenCalled();
  });
});

/**
 * Ownership boundary — the criterion this sprint is judged on.
 * AP stores job allocation for reporting but must never write job or AR values.
 */
describe('Ownership boundary: AP never writes job or AR values', () => {
  const cases: [string, (s: PayablesService) => Promise<unknown>][] = [
    ['create', (s) => s.create({ vendorId: 'v1', vendorInvoiceNo: 'INV-900', jobId: 'j1', items: [{ description: 'X', unitPrice: 100, quantity: 1, jobId: 'j1' }] })],
    ['approve', (s) => s.approve('b1')],
    ['recordPayment', (s) => s.recordPayment('b1', { amount: 100 })],
    ['void', (s) => s.void('b1', 'reason')],
    ['reversePayment', (s) => s.reversePayment('p1', { reason: 'reason' })],
  ];

  it.each(cases)('%s never touches job / invoice / note write delegates', async (_name, run) => {
    const { service, forbidden } = makeService({
      vendor, duplicate: null, jobs: [{ id: 'j1' }],
      bill: { id: 'b1', status: 'APPROVED', totalAmount: 1000, amountPaid: 0, vendorId: 'v1', vendorInvoiceNo: 'INV-900', billNumber: 'BILL-2026-0001' },
      payment: { id: 'p1', billId: 'b1', amount: 100, reversedAt: null },
      remainingPaid: 0,
    });
    await run(service).catch(() => undefined); // guard rejections are fine; the assertion is about writes
    for (const [method, fn] of Object.entries(forbidden)) {
      expect({ method, calls: (fn as jest.Mock).mock.calls.length }).toEqual({ method, calls: 0 });
    }
  });

  it('writes only vendor-bill fields when recording a payment (no cost/profit keys)', async () => {
    const { service, writes } = makeService({ bill: { id: 'b1', status: 'APPROVED', totalAmount: 1000, amountPaid: 0 } });
    await service.recordPayment('b1', { amount: 250 });
    const keys = Object.keys(writes.billUpdates[0]);
    expect(keys.sort()).toEqual(['amountPaid', 'status']);
    for (const forbiddenKey of ['actualCost', 'profit', 'actualRevenue']) {
      expect(keys).not.toContain(forbiddenKey);
    }
  });
});
