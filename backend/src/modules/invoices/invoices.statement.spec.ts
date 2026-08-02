import { InvoicesService } from './invoices.service';

/**
 * Sprint 05 / P0-8 — AR overdue automation + Statement of Account.
 * Stubbed dependencies (no database), mirroring invoices.service.spec.ts.
 */

describe('Overdue computation', () => {
  function makeGetService(invoice: Record<string, unknown> | null) {
    const prisma = { invoice: { findUnique: jest.fn(async () => invoice) } };
    return new InvoicesService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  }

  it('flags an ISSUED invoice past its due date as overdue', async () => {
    const service = makeGetService({
      id: 'i1', status: 'ISSUED', dueDate: new Date(Date.now() - 5 * 86400000), customer: {}, job: null, items: [], payments: [],
    });
    const result = await service.get('i1');
    expect(result.isOverdue).toBe(true);
    expect(result.daysOverdue).toBeGreaterThanOrEqual(5);
  });

  it('does not flag a PAID invoice even if its due date has passed', async () => {
    const service = makeGetService({
      id: 'i1', status: 'PAID', dueDate: new Date(Date.now() - 5 * 86400000), customer: {}, job: null, items: [], payments: [],
    });
    const result = await service.get('i1');
    expect(result.isOverdue).toBe(false);
  });

  it('does not flag an invoice whose due date is in the future', async () => {
    const service = makeGetService({
      id: 'i1', status: 'ISSUED', dueDate: new Date(Date.now() + 5 * 86400000), customer: {}, job: null, items: [], payments: [],
    });
    const result = await service.get('i1');
    expect(result.isOverdue).toBe(false);
  });

  it('does not flag a DRAFT invoice with no due date', async () => {
    const service = makeGetService({ id: 'i1', status: 'DRAFT', dueDate: null, customer: {}, job: null, items: [], payments: [] });
    const result = await service.get('i1');
    expect(result.isOverdue).toBe(false);
    expect(result.daysOverdue).toBeNull();
  });
});

describe('Customer Statement of Account', () => {
  function makeStatementService() {
    const invoiceRow = {
      id: 'inv-1', invoiceNumber: 'INV-2026-0001', customerId: 'cus-1', currency: 'MYR',
      totalAmount: 1000, amountPaid: 400, issueDate: new Date('2026-01-01'),
      payments: [{ id: 'p1', amount: 400, paidAt: new Date('2026-01-10') }],
    };
    const prisma = {
      customer: { findUnique: jest.fn(async () => ({ id: 'cus-1', companyName: 'Acme', code: 'C001', email: 'acme@x.com', currency: 'MYR' })) },
      invoice: { findMany: jest.fn(async () => [invoiceRow]) },
      creditDebitNote: {
        findMany: jest.fn(async () => [
          { noteNumber: 'CN-2026-0001', type: 'CREDIT', totalAmount: 100, currency: 'MYR', issueDate: new Date('2026-01-15') },
        ]),
        groupBy: jest.fn(async () => [{ invoiceId: 'inv-1', type: 'CREDIT', _sum: { totalAmount: 100 } }]),
      },
    };
    const fx = {
      converter: jest.fn(async () => ({ toBase: (a: number) => a, missing: new Set<string>(), baseCurrency: 'MYR' })),
      warning: jest.fn(() => null),
    };
    return new InvoicesService(prisma as never, {} as never, {} as never, {} as never, fx as never, {} as never);
  }

  it('builds a chronological ledger with a running balance', async () => {
    const service = makeStatementService();
    const statement = await service.customerStatement('cus-1');
    expect(statement.rows.map((r) => r.type)).toEqual(['INVOICE', 'PAYMENT', 'CREDIT_NOTE']);
    // 1000 (invoice) - 400 (payment) - 100 (credit note) = 500
    expect(statement.nativeClosingBalance).toBe(500);
  });

  it('agrees with the base-currency exposure the credit control panel and AR aging use — same invariant as issuedNoteNetMap', async () => {
    const service = makeStatementService();
    const statement = await service.customerStatement('cus-1');
    expect(statement.baseCurrencyExposure).toBe(statement.nativeClosingBalance);
  });

  it('flags mixed-currency activity so the native running balance is not read as authoritative', async () => {
    const service = makeStatementService();
    // Override the mock's currency for a second call to simulate a mixed book.
    (service as unknown as { prisma: { invoice: { findMany: jest.Mock } } }).prisma.invoice.findMany
      .mockResolvedValueOnce([
        { id: 'inv-1', invoiceNumber: 'INV-1', customerId: 'cus-1', currency: 'MYR', totalAmount: 1000, amountPaid: 0, issueDate: new Date('2026-01-01'), payments: [] },
        { id: 'inv-2', invoiceNumber: 'INV-2', customerId: 'cus-1', currency: 'USD', totalAmount: 200, amountPaid: 0, issueDate: new Date('2026-01-02'), payments: [] },
      ]);
    const statement = await service.customerStatement('cus-1');
    expect(statement.mixedCurrency).toBe(true);
  });
});
