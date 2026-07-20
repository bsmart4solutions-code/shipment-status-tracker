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
  const service = new InvoicesService(prisma as never, seq as never, audit as never, mail as never);
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
