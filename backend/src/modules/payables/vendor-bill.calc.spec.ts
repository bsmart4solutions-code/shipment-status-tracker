import { computeInvoiceTotals, priceInvoiceItem, OverpaymentError, NonPositivePaymentError } from '../invoices/invoice.calc';
import {
  applyVendorPayment, computeVendorBillTotals, outstandingOfBill, recomputeAfterReversal,
} from './vendor-bill.calc';

describe('Vendor bill totals', () => {
  it('matches the invoice engine exactly for the same lines (single tax engine)', () => {
    const items = [
      { unitPrice: 2050, quantity: 1, taxExempt: true }, // ocean freight, SVE
      { unitPrice: 635, quantity: 1 },                    // THC, SV
      { unitPrice: 250, quantity: 1 },                    // B/L, SV
    ];
    const bill = computeVendorBillTotals(items, 6);
    const invoice = computeInvoiceTotals(items.map((i) => priceInvoiceItem(i)), 6);
    expect(bill.subtotal).toBe(invoice.subtotal);
    expect(bill.taxableSubtotal).toBe(invoice.taxableSubtotal);
    expect(bill.taxAmt).toBe(invoice.taxAmt);
    expect(bill.totalAmount).toBe(invoice.totalAmount);
  });

  it('excludes SVE lines from the tax base', () => {
    const t = computeVendorBillTotals([
      { unitPrice: 1000, quantity: 1, taxExempt: true },
      { unitPrice: 200, quantity: 1 },
    ], 6);
    expect(t.subtotal).toBe(1200);
    expect(t.taxAmt).toBe(12); // 6% of 200 only
    expect(t.totalAmount).toBe(1212);
  });

  it('applies fx per line into the bill currency', () => {
    // USD 100 × 2 × 4.20 = 840.00
    const t = computeVendorBillTotals([{ unitPrice: 100, quantity: 2, fxRate: 4.2 }], 0);
    expect(t.subtotal).toBe(840);
    expect(t.totalAmount).toBe(840);
  });

  it('treats SST as a cost that increases what is owed (no input credit)', () => {
    const t = computeVendorBillTotals([{ unitPrice: 1000, quantity: 1 }], 8);
    expect(t.taxAmt).toBe(80);
    expect(t.totalAmount).toBe(1080); // the full 1080 is payable, nothing reclaimable
  });
});

describe('Outstanding on a vendor bill', () => {
  it('is total minus paid while the bill is a live payable', () => {
    expect(outstandingOfBill({ totalAmount: 1000, amountPaid: 0, status: 'APPROVED' })).toBe(1000);
    expect(outstandingOfBill({ totalAmount: 1000, amountPaid: 400, status: 'PARTIALLY_PAID' })).toBe(600);
  });

  it('is zero for statuses that owe nothing', () => {
    expect(outstandingOfBill({ totalAmount: 1000, amountPaid: 0, status: 'DRAFT' })).toBe(0);
    expect(outstandingOfBill({ totalAmount: 1000, amountPaid: 0, status: 'VOID' })).toBe(0);
    expect(outstandingOfBill({ totalAmount: 1000, amountPaid: 1000, status: 'PAID' })).toBe(0);
  });
});

describe('Vendor payment application', () => {
  it('marks PARTIALLY_PAID when a balance remains', () => {
    expect(applyVendorPayment(1000, 0, 400)).toEqual({ newAmountPaid: 400, newStatus: 'PARTIALLY_PAID' });
  });

  it('marks PAID when the final payment settles the balance', () => {
    expect(applyVendorPayment(1000, 600, 400)).toEqual({ newAmountPaid: 1000, newStatus: 'PAID' });
  });

  it('rejects overpayment beyond the remaining balance', () => {
    expect(() => applyVendorPayment(1000, 600, 500)).toThrow(OverpaymentError);
    expect(() => applyVendorPayment(1000, 600, 500)).toThrow(/exceeds remaining balance of 400/);
  });

  it('rejects zero and negative payments', () => {
    expect(() => applyVendorPayment(1000, 0, 0)).toThrow(NonPositivePaymentError);
    expect(() => applyVendorPayment(1000, 0, -50)).toThrow(NonPositivePaymentError);
  });

  it('accepts an exact-to-the-cent final payment without float drift', () => {
    expect(applyVendorPayment(0.3, 0.1, 0.2)).toEqual({ newAmountPaid: 0.3, newStatus: 'PAID' });
  });
});

// PO Decision 1 — payment reversal. Status is re-derived from the remaining
// non-reversed payments; it is never set by a caller.
describe('Payment reversal recomputation', () => {
  it('returns the bill to APPROVED when the only payment is reversed', () => {
    expect(recomputeAfterReversal(1000, 0)).toEqual({ newAmountPaid: 0, newStatus: 'APPROVED' });
  });

  it('returns a fully-paid bill to PARTIALLY_PAID when one of two payments is reversed', () => {
    // 1000 bill paid 600 + 400; reversing the 400 leaves 600
    expect(recomputeAfterReversal(1000, 600)).toEqual({ newAmountPaid: 600, newStatus: 'PARTIALLY_PAID' });
  });

  it('stays PAID when the remaining payments still cover the bill', () => {
    expect(recomputeAfterReversal(1000, 1000)).toEqual({ newAmountPaid: 1000, newStatus: 'PAID' });
  });

  it('treats a negative or float-drifting remainder as zero', () => {
    expect(recomputeAfterReversal(1000, -0.0000001)).toEqual({ newAmountPaid: 0, newStatus: 'APPROVED' });
  });

  it('rounds the recomputed total to cents', () => {
    expect(recomputeAfterReversal(1000, 0.1 + 0.2)).toEqual({ newAmountPaid: 0.3, newStatus: 'PARTIALLY_PAID' });
  });
});
