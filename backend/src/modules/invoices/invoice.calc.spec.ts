import {
  applyPayment, computeInvoiceTotals, computeTotals, NonPositivePaymentError, OverpaymentError,
  priceInvoiceItem,
} from './invoice.calc';

describe('Invoice totals', () => {
  it('computes tax and grand total from subtotal + taxPct', () => {
    expect(computeTotals(1000, 6)).toEqual({ taxAmt: 60, totalAmount: 1060 });
  });

  it('handles zero tax', () => {
    expect(computeTotals(1500, 0)).toEqual({ taxAmt: 0, totalAmount: 1500 });
  });

  it('rounds tax to 2 decimals', () => {
    // 333.33 × 6% = 19.9998 → 20.00
    expect(computeTotals(333.33, 6)).toEqual({ taxAmt: 20, totalAmount: 353.33 });
  });

  it('handles fractional tax percentages', () => {
    // 1000 × 8.25% = 82.50
    expect(computeTotals(1000, 8.25)).toEqual({ taxAmt: 82.5, totalAmount: 1082.5 });
  });
});

describe('Invoice line items', () => {
  it('prices a line into invoice currency via fx', () => {
    // USD 745.18 × 10 × 3.95 → 29434.61 MYR
    expect(priceInvoiceItem({ unitPrice: 745.18, quantity: 10, fxRate: 3.95 })).toEqual({
      amount: 29434.61, taxExempt: false,
    });
  });

  it('defaults fx to 1 and taxExempt to false', () => {
    expect(priceInvoiceItem({ unitPrice: 100, quantity: 2 })).toEqual({ amount: 200, taxExempt: false });
  });

  it('excludes SVE lines (ocean freight) from the tax base', () => {
    const lines = [
      priceInvoiceItem({ unitPrice: 2050, quantity: 1, taxExempt: true }), // ocean freight
      priceInvoiceItem({ unitPrice: 635, quantity: 1 }),                    // THC
      priceInvoiceItem({ unitPrice: 250, quantity: 1 }),                    // B/L
    ];
    const t = computeInvoiceTotals(lines, 6);
    expect(t.subtotal).toBe(2935);
    expect(t.taxableSubtotal).toBe(885);
    expect(t.taxAmt).toBe(53.1); // 6% of 885 only
    expect(t.totalAmount).toBe(2988.1);
  });

  it('matches flat subtotal × taxPct when no line is exempt', () => {
    const lines = [priceInvoiceItem({ unitPrice: 1000, quantity: 1 })];
    const t = computeInvoiceTotals(lines, 6);
    expect(t.taxAmt).toBe(60);
    expect(t.totalAmount).toBe(1060);
  });
});

describe('Invoice payment application', () => {
  it('marks PARTIALLY_PAID when balance remains', () => {
    expect(applyPayment(1000, 0, 400)).toEqual({ newAmountPaid: 400, newStatus: 'PARTIALLY_PAID' });
  });

  it('marks PAID when the final payment settles the balance', () => {
    expect(applyPayment(1000, 400, 600)).toEqual({ newAmountPaid: 1000, newStatus: 'PAID' });
  });

  it('marks PAID when a single payment covers the whole invoice', () => {
    expect(applyPayment(1080, 0, 1080)).toEqual({ newAmountPaid: 1080, newStatus: 'PAID' });
  });

  it('rejects overpayment beyond the remaining balance', () => {
    expect(() => applyPayment(1080, 0, 2000)).toThrow(OverpaymentError);
    expect(() => applyPayment(1080, 0, 2000)).toThrow(/exceeds remaining balance of 1080/);
  });

  it('rejects overpayment on an already partially-paid invoice', () => {
    // 1000 total, 700 paid, 300 remains — a 400 payment must be refused
    expect(() => applyPayment(1000, 700, 400)).toThrow(OverpaymentError);
  });

  it('rejects zero and negative payments', () => {
    expect(() => applyPayment(1000, 0, 0)).toThrow(NonPositivePaymentError);
    expect(() => applyPayment(1000, 0, -50)).toThrow(NonPositivePaymentError);
  });

  it('accepts an exact-to-the-cent final payment without float drift', () => {
    // 0.1 + 0.2 style accumulation must not block a legitimate exact payoff
    expect(applyPayment(0.3, 0.1, 0.2)).toEqual({ newAmountPaid: 0.3, newStatus: 'PAID' });
  });
});
