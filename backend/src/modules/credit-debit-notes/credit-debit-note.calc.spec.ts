import { computeInvoiceTotals, priceInvoiceItem } from '../invoices/invoice.calc';
import { assertWithinCreditable, computeNoteTotals, OverCreditError } from './credit-debit-note.calc';

describe('Credit/Debit note totals', () => {
  it('matches the invoice engine exactly for the same lines (tax parity)', () => {
    const items = [
      { unitPrice: 2050, quantity: 1, taxExempt: true },  // ocean freight, SVE
      { unitPrice: 635, quantity: 1 },                     // THC, SV
      { unitPrice: 250, quantity: 1 },                     // B/L, SV
    ];
    const note = computeNoteTotals(items, 6);
    const invoice = computeInvoiceTotals(items.map((i) => priceInvoiceItem(i)), 6);
    expect(note.subtotal).toBe(invoice.subtotal);           // 2935
    expect(note.taxableSubtotal).toBe(invoice.taxableSubtotal); // 885
    expect(note.taxAmt).toBe(invoice.taxAmt);               // 53.10
    expect(note.totalAmount).toBe(invoice.totalAmount);     // 2988.10
  });

  it('excludes SVE lines from the tax base', () => {
    const t = computeNoteTotals([
      { unitPrice: 1000, quantity: 1, taxExempt: true },
      { unitPrice: 200, quantity: 1 },
    ], 6);
    expect(t.subtotal).toBe(1200);
    expect(t.taxAmt).toBe(12); // 6% of 200 only
    expect(t.totalAmount).toBe(1212);
  });

  it('applies fx per line into the note currency', () => {
    // USD 100 × 2 × 4.20 = 840.00
    const t = computeNoteTotals([{ unitPrice: 100, quantity: 2, fxRate: 4.2 }], 0);
    expect(t.subtotal).toBe(840);
    expect(t.totalAmount).toBe(840);
  });

  it('computes a standalone (no-invoice) debit note like any tax document', () => {
    const t = computeNoteTotals([{ unitPrice: 50, quantity: 1 }], 6);
    expect(t.taxAmt).toBe(3);
    expect(t.totalAmount).toBe(53);
  });
});

describe('Over-credit guard', () => {
  it('allows a credit note within the invoice creditable balance', () => {
    expect(() => assertWithinCreditable(848, 1060, 212)).not.toThrow();
  });

  it('allows crediting the exact remaining balance to the cent', () => {
    expect(() => assertWithinCreditable(1060, 1060, 0)).not.toThrow();
    // float-accumulation must not block a legitimate exact payoff
    expect(() => assertWithinCreditable(0.3, 0.1 + 0.2, 0)).not.toThrow();
  });

  it('rejects a credit note beyond the creditable balance', () => {
    expect(() => assertWithinCreditable(1000, 1060, 212)).toThrow(OverCreditError);
    expect(() => assertWithinCreditable(1000, 1060, 212)).toThrow(/exceeds the invoice's creditable balance of 848/);
  });

  it('rejects any credit against a fully-credited invoice', () => {
    expect(() => assertWithinCreditable(0.01, 1060, 1060)).toThrow(OverCreditError);
  });
});

// Regression: H2 (ARCHITECTURE_REVIEW) — the guard must also subtract cash
// already received, so credit + payments can never exceed the invoice value.
describe('Over-credit guard with payments received (amountPaid)', () => {
  it('allows crediting exactly the unpaid remainder', () => {
    // 1000 invoice, 600 paid -> 400 creditable
    expect(() => assertWithinCreditable(400, 1000, 0, 600)).not.toThrow();
  });

  it('rejects a credit note beyond the unpaid remainder', () => {
    expect(() => assertWithinCreditable(401, 1000, 0, 600)).toThrow(OverCreditError);
    expect(() => assertWithinCreditable(401, 1000, 0, 600)).toThrow(/creditable balance of 400/);
  });

  it('rejects any credit against a fully-paid invoice', () => {
    expect(() => assertWithinCreditable(0.01, 1000, 0, 1000)).toThrow(OverCreditError);
  });

  it('combines payments and prior credits: 1000 − 600 paid − 300 credited = 100 creditable', () => {
    expect(() => assertWithinCreditable(100, 1000, 300, 600)).not.toThrow();
    expect(() => assertWithinCreditable(100.01, 1000, 300, 600)).toThrow(OverCreditError);
  });

  it('omitting amountPaid keeps the original behaviour (backward compatibility)', () => {
    expect(() => assertWithinCreditable(1060, 1060, 0)).not.toThrow();
  });
});
