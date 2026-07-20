import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreditDebitNotesService } from './credit-debit-notes.service';
import { CreateNoteDto, UpdateNoteDto } from './credit-debit-notes.dto';

/**
 * Service-level regression tests for the ARCHITECTURE_REVIEW High fixes,
 * with stubbed Prisma/sequence/audit (no database).
 *  - H4: an invoice-linked note is pinned to the invoice currency on create
 *        and cannot change currency on update.
 *  - H2: create() rejects a credit note beyond the invoice's unpaid remainder.
 */

function makeService(overrides: {
  invoice?: Record<string, unknown> | null;
  issuedCreditSum?: number;
}) {
  const created: { data?: Record<string, unknown> } = {};
  const updated: { data?: Record<string, unknown> } = {};
  const tx = {
    creditDebitNoteItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    creditDebitNote: {
      update: jest.fn(async (args: { data: Record<string, unknown> }) => { updated.data = args.data; return { id: 'note-1', ...args.data }; }),
    },
  };
  const prisma = {
    invoice: { findUnique: jest.fn(async () => overrides.invoice ?? null) },
    creditDebitNote: {
      aggregate: jest.fn(async () => ({ _sum: { totalAmount: overrides.issuedCreditSum ?? 0 } })),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => { created.data = args.data; return { id: 'note-1', ...args.data }; }),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const seq = { next: jest.fn(async () => 'CN-2026-0001') };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new CreditDebitNotesService(prisma as never, seq as never, audit as never);
  return { service, prisma, created, updated };
}

const oneLine = [{ description: 'Export clearance', unitPrice: 100, quantity: 1 }];

describe('H4 — invoice-linked note currency is pinned to the invoice', () => {
  it('create() overrides a mismatching DTO currency with the invoice currency', async () => {
    const { service, created } = makeService({
      invoice: { id: 'inv-1', customerId: 'cus-1', currency: 'MYR', status: 'ISSUED', totalAmount: 1000, amountPaid: 0 },
    });
    await service.create({ type: 'CREDIT', invoiceId: 'inv-1', currency: 'USD', taxPct: 0, reason: 'over-billed', items: oneLine });
    expect(created.data?.currency).toBe('MYR');
  });

  it('create() keeps the chosen currency for a standalone debit note', async () => {
    const { service, created } = makeService({ invoice: null });
    await service.create({ type: 'DEBIT', customerId: 'cus-1', currency: 'USD', taxPct: 0, reason: 'storage charges', items: oneLine });
    expect(created.data?.currency).toBe('USD');
  });

  it('update() ignores a currency change on an invoice-linked DRAFT note', async () => {
    const { service, prisma, updated } = makeService({});
    prisma.creditDebitNote.findUnique.mockResolvedValue({
      id: 'note-1', status: 'DRAFT', invoiceId: 'inv-1', taxPct: 0,
    } as never);
    await service.update('note-1', { currency: 'USD', reason: 'edited' });
    expect(updated.data?.currency).toBeUndefined();
  });

  it('update() still allows a currency change on a standalone DRAFT note', async () => {
    const { service, prisma, updated } = makeService({});
    prisma.creditDebitNote.findUnique.mockResolvedValue({
      id: 'note-1', status: 'DRAFT', invoiceId: null, taxPct: 0,
    } as never);
    await service.update('note-1', { currency: 'USD' });
    expect(updated.data?.currency).toBe('USD');
  });
});

describe('H2 — create() enforces the unpaid-remainder guard', () => {
  it('rejects a credit note larger than total − paid − already credited', async () => {
    const { service } = makeService({
      invoice: { id: 'inv-1', customerId: 'cus-1', currency: 'MYR', status: 'ISSUED', totalAmount: 1000, amountPaid: 600 },
      issuedCreditSum: 0,
    });
    // 700 > 1000 − 600 remaining
    await expect(
      service.create({ type: 'CREDIT', invoiceId: 'inv-1', taxPct: 0, reason: 'refund', items: [{ description: 'X', unitPrice: 700, quantity: 1 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a credit note within the unpaid remainder', async () => {
    const { service, created } = makeService({
      invoice: { id: 'inv-1', customerId: 'cus-1', currency: 'MYR', status: 'ISSUED', totalAmount: 1000, amountPaid: 600 },
      issuedCreditSum: 0,
    });
    await service.create({ type: 'CREDIT', invoiceId: 'inv-1', taxPct: 0, reason: 'partial refund', items: [{ description: 'X', unitPrice: 400, quantity: 1 }] });
    expect(created.data?.totalAmount).toBe(400);
  });
});

/**
 * M2 regression — issue() must hold guard-check and status-write in one
 * serialized transaction so two concurrent issues cannot jointly over-credit.
 * The fake $transaction chains callers on a mutex (exactly what the DB's
 * FOR UPDATE row lock provides) over shared state: with the fix, the second
 * issue sees the first one's ISSUED total and is rejected.
 */
describe('M2 — concurrent issue protection', () => {
  function makeIssueWorld(invoice: { totalAmount: number; amountPaid: number }) {
    const state = {
      notes: new Map<string, { id: string; type: string; status: string; invoiceId: string; totalAmount: number; issueDate: Date; createdAt: Date }>(),
      lockQueue: Promise.resolve() as Promise<unknown>,
      usedForUpdate: false,
    };
    const tx = {
      creditDebitNote: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state.notes.get(where.id) ?? null),
        aggregate: jest.fn(async ({ where }: { where: { id?: { not?: string } } }) => {
          let sum = 0;
          for (const n of state.notes.values()) {
            if (n.status === 'ISSUED' && n.type === 'CREDIT' && n.id !== where.id?.not) sum += n.totalAmount;
          }
          return { _sum: { totalAmount: sum } };
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const n = state.notes.get(where.id)!;
          Object.assign(n, data);
          return n;
        }),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        if (strings.join('?').includes('FOR UPDATE')) state.usedForUpdate = true;
        return [invoice];
      }),
    };
    const prisma = {
      // Serialize transactions exactly like the invoice row lock does.
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => {
        const run = state.lockQueue.then(() => fn(tx), () => fn(tx));
        state.lockQueue = run.catch(() => undefined);
        return run;
      }),
    };
    const service = new CreditDebitNotesService(prisma as never, { next: jest.fn() } as never, { log: jest.fn() } as never);
    return { service, state };
  }

  it('rejects the second of two concurrent issues that jointly exceed the balance', async () => {
    const { service, state } = makeIssueWorld({ totalAmount: 1000, amountPaid: 0 });
    const base = { type: 'CREDIT', status: 'DRAFT', invoiceId: 'inv-1', totalAmount: 600, issueDate: new Date(), createdAt: new Date() };
    state.notes.set('cn-a', { id: 'cn-a', ...base });
    state.notes.set('cn-b', { id: 'cn-b', ...base });

    const results = await Promise.allSettled([service.issue('cn-a'), service.issue('cn-b')]);
    const outcomes = results.map((r) => r.status).sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']); // exactly one wins
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
    expect(state.usedForUpdate).toBe(true); // the invoice row was locked
  });

  it('allows two concurrent issues that fit within the balance together', async () => {
    const { service, state } = makeIssueWorld({ totalAmount: 1000, amountPaid: 0 });
    const base = { type: 'CREDIT', status: 'DRAFT', invoiceId: 'inv-1', totalAmount: 400, issueDate: new Date(), createdAt: new Date() };
    state.notes.set('cn-a', { id: 'cn-a', ...base });
    state.notes.set('cn-b', { id: 'cn-b', ...base });
    const results = await Promise.allSettled([service.issue('cn-a'), service.issue('cn-b')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  });
});

/** M3 regression — the SST tax-point date is stamped at posting time. */
describe('M3 — issueDate stamping on DRAFT→ISSUED', () => {
  function makeIssueService(note: Record<string, unknown>) {
    const updated: { data?: Record<string, unknown> } = {};
    const tx = {
      creditDebitNote: {
        findUnique: jest.fn(async () => note),
        aggregate: jest.fn(async () => ({ _sum: { totalAmount: 0 } })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { updated.data = data; return { ...note, ...data }; }),
      },
      $queryRaw: jest.fn(async () => [{ totalAmount: 1000, amountPaid: 0 }]),
    };
    const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    const service = new CreditDebitNotesService(prisma as never, { next: jest.fn() } as never, { log: jest.fn() } as never);
    return { service, updated };
  }

  it('restamps an auto-dated draft to the posting time', async () => {
    const created = new Date('2026-07-01T09:15:22Z');
    const { service, updated } = makeIssueService({
      id: 'n1', type: 'CREDIT', status: 'DRAFT', invoiceId: 'inv-1', totalAmount: 100,
      createdAt: created, issueDate: new Date(created.getTime() + 20), // creation default
    });
    await service.issue('n1');
    expect(updated.data?.issueDate).toBeInstanceOf(Date);
    expect((updated.data?.issueDate as Date).getTime()).toBeGreaterThan(created.getTime() + 5_000);
  });

  it('preserves an explicitly chosen document date', async () => {
    const { service, updated } = makeIssueService({
      id: 'n1', type: 'CREDIT', status: 'DRAFT', invoiceId: 'inv-1', totalAmount: 100,
      createdAt: new Date('2026-07-01T09:15:22Z'), issueDate: new Date('2026-06-30T00:00:00Z'), // user-picked
    });
    await service.issue('n1');
    expect(updated.data?.issueDate).toBeUndefined(); // untouched
  });
});

/** M4 regression — update cannot weaken create-path invariants. */
describe('M4 — DTO tightening', () => {
  it('rejects PATCH items: [] (a note must keep at least one line)', async () => {
    const errors = await validate(plainToInstance(UpdateNoteDto, { items: [] }));
    expect(errors.some((e) => e.property === 'items')).toBe(true);
  });

  it('rejects a blank reason on update', async () => {
    const errors = await validate(plainToInstance(UpdateNoteDto, { reason: '' }));
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });

  it('rejects a blank reason on create', async () => {
    const errors = await validate(plainToInstance(CreateNoteDto, {
      type: 'CREDIT', invoiceId: '3f0e6a4e-0000-4000-8000-000000000000', reason: '',
      items: [{ description: 'X', unitPrice: 1, quantity: 1 }],
    }));
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });

  it('still accepts a valid update payload', async () => {
    const errors = await validate(plainToInstance(UpdateNoteDto, {
      reason: 'corrected quantity', items: [{ description: 'X', unitPrice: 1, quantity: 1 }],
    }));
    expect(errors).toEqual([]);
  });
});
