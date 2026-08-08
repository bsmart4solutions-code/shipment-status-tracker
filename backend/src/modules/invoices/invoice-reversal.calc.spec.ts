import { recomputeInvoiceAfterReversal } from './invoice.calc';

/**
 * Pure arithmetic for undoing a receipt (Sprint 07 — AR payment reversal).
 *
 * The status is always re-derived from what payments SURVIVE, never adjusted
 * from the stored figure. Subtracting the reversed amount from `amountPaid`
 * would look equivalent and is not: it carries forward any drift already in
 * that column instead of correcting it.
 */
describe('recomputeInvoiceAfterReversal', () => {
  it('returns an invoice with no surviving payments to ISSUED, not DRAFT', () => {
    // The invoice was issued and stays issued — only the cash is undone.
    // Returning it to DRAFT would make an issued tax document editable again.
    expect(recomputeInvoiceAfterReversal(1000, 0)).toEqual({ newAmountPaid: 0, newStatus: 'ISSUED' });
  });

  it('drops a fully-paid invoice back to PARTIALLY_PAID when one of two receipts is reversed', () => {
    expect(recomputeInvoiceAfterReversal(1000, 400)).toEqual({ newAmountPaid: 400, newStatus: 'PARTIALLY_PAID' });
  });

  it('stays PAID when the surviving payments still cover the invoice', () => {
    // Reversing a duplicate receipt on an over-covered invoice.
    expect(recomputeInvoiceAfterReversal(1000, 1000)).toEqual({ newAmountPaid: 1000, newStatus: 'PAID' });
  });

  it('rebuilds from the surviving rows rather than subtracting from the stored total', () => {
    // 300 + 250 survive after a 450 reversal. The answer depends only on the
    // survivors, so a wrong stored amountPaid cannot propagate.
    expect(recomputeInvoiceAfterReversal(1000, 550)).toEqual({ newAmountPaid: 550, newStatus: 'PARTIALLY_PAID' });
  });

  describe('with credit/debit notes on the invoice', () => {
    it('settles against the NETTED total, not the face value', () => {
      // 1000 invoice, 400 credit note issued ⇒ only 600 is collectible.
      // 600 received therefore leaves it PAID even though 600 < 1000.
      expect(recomputeInvoiceAfterReversal(1000, 600, -400)).toEqual({ newAmountPaid: 600, newStatus: 'PAID' });
    });

    it('a debit note raises the bar, so the same cash is no longer full settlement', () => {
      expect(recomputeInvoiceAfterReversal(1000, 1000, 200)).toEqual({ newAmountPaid: 1000, newStatus: 'PARTIALLY_PAID' });
    });

    it('keeps an invoice PAID when a credit note issued after payment puts collectible BELOW cash received', () => {
      // 1000 invoiced, 1000 received, then a 300 credit note ⇒ collectible 700.
      // Reversing an unrelated 0-value has no effect; the surviving 1000 still
      // exceeds 700, and the invoice is settled. `>=` rather than `===` is what
      // makes this work — an exact match would misreport it as PARTIALLY_PAID.
      expect(recomputeInvoiceAfterReversal(1000, 1000, -300)).toEqual({ newAmountPaid: 1000, newStatus: 'PAID' });
    });
  });

  it('rounds to cents rather than carrying float drift into the ledger', () => {
    const out = recomputeInvoiceAfterReversal(1000, 0.1 + 0.2);
    expect(out.newAmountPaid).toBe(0.3);
    expect(out.newStatus).toBe('PARTIALLY_PAID');
  });
});
