/**
 * Pure invoice arithmetic, extracted from InvoicesService so the money math
 * can be unit-tested without a database. The service is responsible for
 * persistence and status-transition assertions; this module only computes.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Server-side totals. Tax and grand total are always derived here so a
 * client can never post an arbitrary total — only subtotal and taxPct are
 * trusted inputs.
 */
export function computeTotals(subtotal: number, taxPct: number): { taxAmt: number; totalAmount: number } {
  const taxAmt = round2(subtotal * (taxPct / 100));
  return { taxAmt, totalAmount: round2(subtotal + taxAmt) };
}

export interface InvoiceItemInput {
  unitPrice: number;
  quantity: number;
  fxRate?: number;      // lineCurrency -> invoice currency (default 1)
  taxExempt?: boolean;  // SVE 0% line (e.g. ocean freight)
}

export interface PricedInvoiceItem {
  amount: number;       // qty × unitPrice × fx, excl tax, in invoice currency
  taxExempt: boolean;
}

/** Price one invoice line into the invoice currency (amount excl. tax). */
export function priceInvoiceItem(item: InvoiceItemInput): PricedInvoiceItem {
  const qty = Number(item.quantity) || 0;
  const fx = Number(item.fxRate ?? 1) || 1;
  const amount = round2(qty * (Number(item.unitPrice) || 0) * fx);
  return { amount, taxExempt: item.taxExempt ?? false };
}

/**
 * Roll priced lines up into invoice totals. SVE 0% (tax-exempt) lines —
 * ocean freight per the standard T&C — are excluded from the tax base, so
 * `taxAmt` is a single `taxPct` applied only to the taxable subtotal. With
 * no exempt lines this equals subtotal × taxPct, identical to the flat path.
 */
export function computeInvoiceTotals(
  lines: PricedInvoiceItem[], taxPct: number,
): { subtotal: number; taxableSubtotal: number; taxAmt: number; totalAmount: number } {
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxableSubtotal = round2(lines.reduce((s, l) => s + (l.taxExempt ? 0 : l.amount), 0));
  const taxAmt = round2(taxableSubtotal * (taxPct / 100));
  return { subtotal, taxableSubtotal, taxAmt, totalAmount: round2(subtotal + taxAmt) };
}

export interface PaymentOutcome {
  newAmountPaid: number;
  /** Derived status after applying the payment. */
  newStatus: 'PARTIALLY_PAID' | 'PAID';
}

export class OverpaymentError extends Error {
  constructor(public readonly amount: number, public readonly remaining: number) {
    super(`Payment of ${amount} exceeds remaining balance of ${remaining}`);
    this.name = 'OverpaymentError';
  }
}

export class NonPositivePaymentError extends Error {
  constructor(public readonly amount: number) {
    super(`Payment amount must be positive, got ${amount}`);
    this.name = 'NonPositivePaymentError';
  }
}

/**
 * Apply a payment to an invoice's running total.
 * - Rejects non-positive amounts.
 * - Rejects overpayment (amount beyond the remaining balance).
 * - Derives PAID once the balance is fully settled, else PARTIALLY_PAID.
 *
 * Throws typed errors so the service can map them to the right HTTP status.
 */
export function applyPayment(totalAmount: number, amountPaid: number, paymentAmount: number): PaymentOutcome {
  if (paymentAmount <= 0) throw new NonPositivePaymentError(paymentAmount);
  const remaining = round2(totalAmount - amountPaid);
  if (paymentAmount > remaining) throw new OverpaymentError(paymentAmount, remaining);
  const newAmountPaid = round2(amountPaid + paymentAmount);
  const newStatus = newAmountPaid >= totalAmount ? 'PAID' : 'PARTIALLY_PAID';
  return { newAmountPaid, newStatus };
}
