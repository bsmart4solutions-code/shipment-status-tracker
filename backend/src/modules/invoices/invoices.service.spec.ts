import { ConflictException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

/**
 * Service-level regression tests for ARCHITECTURE_REVIEW H3, with stubbed
 * dependencies (no database): an invoice with live (DRAFT/ISSUED) credit or
 * debit notes against it must not be cancellable — the create path already
 * forbids raising a note against a cancelled invoice, and the cancel path
 * must not produce that state from the other side.
 */

function makeService(opts: { invoice: Record<string, unknown> | null; liveNoteCount: number }) {
  const prisma = {
    invoice: {
      findUnique: jest.fn(async () => opts.invoice),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...(opts.invoice ?? {}), ...args.data })),
    },
    creditDebitNote: { count: jest.fn(async () => opts.liveNoteCount) },
  };
  const seq = { next: jest.fn() };
  const audit = { log: jest.fn(async () => undefined) };
  const mail = { send: jest.fn() };
  const fx = {
    converter: jest.fn(async () => ({ toBase: (a: number) => a, missing: new Set<string>(), baseCurrency: 'MYR' })),
    warning: jest.fn(() => null),
  };
  const permissions = { userHas: jest.fn(async () => false) };
  const service = new InvoicesService(
    prisma as never, seq as never, audit as never, mail as never, fx as never, permissions as never,
  );
  return { service, prisma };
}

const issuedInvoice = { id: 'inv-1', status: 'ISSUED', amountPaid: 0, totalAmount: 1000 };

describe('H3 — invoice cancel is blocked while notes exist', () => {
  it('refuses to cancel an invoice with an ISSUED note against it', async () => {
    const { service, prisma } = makeService({ invoice: issuedInvoice, liveNoteCount: 1 });
    await expect(service.cancel('inv-1')).rejects.toThrow(ConflictException);
    await expect(service.cancel('inv-1')).rejects.toThrow(/cancel the notes first/);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('counts only live notes (DRAFT/ISSUED) when blocking', async () => {
    const { service, prisma } = makeService({ invoice: issuedInvoice, liveNoteCount: 0 });
    await service.cancel('inv-1');
    expect(prisma.creditDebitNote.count).toHaveBeenCalledWith({
      where: { invoiceId: 'inv-1', status: { in: ['DRAFT', 'ISSUED'] } },
    });
  });

  it('cancels normally when no notes exist', async () => {
    const { service, prisma } = makeService({ invoice: issuedInvoice, liveNoteCount: 0 });
    await service.cancel('inv-1');
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'CANCELLED' } });
  });

  it('still blocks paid invoices before even looking at notes', async () => {
    const { service, prisma } = makeService({ invoice: { ...issuedInvoice, amountPaid: 500 }, liveNoteCount: 0 });
    await expect(service.cancel('inv-1')).rejects.toThrow(/reverse the payments first/);
    expect(prisma.creditDebitNote.count).not.toHaveBeenCalled();
  });
});

/**
 * Sprint 04 / P0-7 — credit enforcement at invoice issue.
 * Approved policy: hard block (D-1), invoice issue is the ONLY gated action
 * (D-2), creditHold is absolute (D-5), override is Administrator/Manager only
 * with a mandatory reason (D-7).
 */
function makeIssueService(opts: {
  customer: { creditLimit: number | null; outstandingLimit: number | null; creditHold: boolean };
  invoiceTotal: number;
  openInvoices?: { id: string; customerId: string; currency: string; totalAmount: number; amountPaid: number }[];
  canOverride?: boolean;
  fxWarning?: string | null;
}) {
  const audit = { log: jest.fn(async () => undefined) };
  const updates: Record<string, unknown>[] = [];
  const invoiceRow = {
    id: 'inv-1', status: 'DRAFT', dueDate: new Date('2026-09-01'), currency: 'MYR',
    totalAmount: opts.invoiceTotal, customerId: 'cus-1',
    customer: { companyName: 'Acme Sdn Bhd', paymentTerm: 'NET 30', ...opts.customer },
  };
  const prisma = {
    invoice: {
      findUnique: jest.fn(async () => invoiceRow),
      findMany: jest.fn(async () => opts.openInvoices ?? []),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { ...invoiceRow, ...data }; }),
    },
    creditDebitNote: { groupBy: jest.fn(async () => []), count: jest.fn(async () => 0) },
  };
  const fx = {
    converter: jest.fn(async () => ({ toBase: (a: number) => a, missing: new Set<string>(), baseCurrency: 'MYR' })),
    warning: jest.fn(() => opts.fxWarning ?? null),
    baseCurrency: () => 'MYR',
  };
  const permissions = { userHas: jest.fn(async () => opts.canOverride ?? false) };
  const service = new InvoicesService(
    prisma as never, { next: jest.fn() } as never, audit as never, { send: jest.fn() } as never,
    fx as never, permissions as never,
  );
  return { service, audit, updates, permissions };
}

const openInvoice = (total: number, paid = 0) =>
  [{ id: 'old-1', customerId: 'cus-1', currency: 'MYR', totalAmount: total, amountPaid: paid }];

describe('Credit enforcement at invoice issue (P0-7)', () => {
  it('issues normally when the customer is under their limit', async () => {
    const { service, updates } = makeIssueService({
      customer: { creditLimit: 10000, outstandingLimit: null, creditHold: false },
      invoiceTotal: 2000, openInvoices: openInvoice(3000),
    });
    await service.issue('inv-1', 'user-1');
    expect(updates[0]).toMatchObject({ status: 'ISSUED' });
  });

  it('blocks with 409 when the invoice would exceed the limit', async () => {
    const { service } = makeIssueService({
      customer: { creditLimit: 4000, outstandingLimit: null, creditHold: false },
      invoiceTotal: 2000, openInvoices: openInvoice(3000),
    });
    await expect(service.issue('inv-1', 'user-1')).rejects.toThrow(ConflictException);
    await expect(service.issue('inv-1', 'user-1')).rejects.toThrow(/Credit limit exceeded/);
  });

  it('blocks unconditionally when the customer is on credit hold, even at zero balance', async () => {
    const { service } = makeIssueService({
      customer: { creditLimit: null, outstandingLimit: null, creditHold: true },
      invoiceTotal: 1, openInvoices: [],
    });
    await expect(service.issue('inv-1', 'user-1')).rejects.toThrow(/on credit hold/);
  });

  it('never blocks a customer with no limit configured', async () => {
    const { service, updates } = makeIssueService({
      customer: { creditLimit: null, outstandingLimit: null, creditHold: false },
      invoiceTotal: 999999, openInvoices: openInvoice(500000),
    });
    await service.issue('inv-1', 'user-1');
    expect(updates[0]).toMatchObject({ status: 'ISSUED' });
  });

  it('fails closed when exposure cannot be computed for want of an exchange rate', async () => {
    const { service } = makeIssueService({
      customer: { creditLimit: 100000, outstandingLimit: null, creditHold: false },
      invoiceTotal: 100, openInvoices: openInvoice(50), fxWarning: 'No exchange rate configured to MYR for: EUR',
    });
    await expect(service.issue('inv-1', 'user-1')).rejects.toThrow(/exchange rate is missing/);
  });

  it('audit-logs the block with the figures behind it', async () => {
    const { service, audit } = makeIssueService({
      customer: { creditLimit: 4000, outstandingLimit: null, creditHold: false },
      invoiceTotal: 2000, openInvoices: openInvoice(3000),
    });
    await service.issue('inv-1', 'user-1').catch(() => undefined);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREDIT_BLOCK',
      detail: expect.objectContaining({ exposure: 3000, effectiveLimit: 4000, projected: 5000, shortfall: 1000 }),
    }));
  });
});

describe('Credit override (D-7)', () => {
  const overLimit = {
    customer: { creditLimit: 4000, outstandingLimit: null, creditHold: false },
    invoiceTotal: 2000, openInvoices: openInvoice(3000),
  };

  it('lets an authorised user issue past the block with a reason', async () => {
    const { service, updates, audit } = makeIssueService({ ...overLimit, canOverride: true });
    await service.issue('inv-1', 'user-1', { creditOverrideReason: 'director approved', user: { id: 'u', roleId: 'r', roleName: 'Manager' } });
    expect(updates[0]).toMatchObject({ status: 'ISSUED' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREDIT_OVERRIDE',
      detail: expect.objectContaining({ reason: 'director approved', exposure: 3000, effectiveLimit: 4000 }),
    }));
  });

  it('refuses the override for a user without the permission (403)', async () => {
    const { service } = makeIssueService({ ...overLimit, canOverride: false });
    await expect(
      service.issue('inv-1', 'user-1', { creditOverrideReason: 'let me through', user: { id: 'u', roleId: 'r', roleName: 'Sales' } }),
    ).rejects.toThrow(/do not have permission to override/);
  });

  it('still blocks when no reason is supplied, even for an authorised user', async () => {
    const { service } = makeIssueService({ ...overLimit, canOverride: true });
    await expect(service.issue('inv-1', 'user-1')).rejects.toThrow(ConflictException);
  });

  it('treats a blank reason as no reason', async () => {
    const { service } = makeIssueService({ ...overLimit, canOverride: true });
    await expect(
      service.issue('inv-1', 'user-1', { creditOverrideReason: '   ', user: { id: 'u', roleId: 'r', roleName: 'Manager' } }),
    ).rejects.toThrow(ConflictException);
  });
});
