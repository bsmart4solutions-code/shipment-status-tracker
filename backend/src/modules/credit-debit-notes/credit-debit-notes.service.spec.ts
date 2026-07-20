import { BadRequestException } from '@nestjs/common';
import { CreditDebitNotesService } from './credit-debit-notes.service';

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
