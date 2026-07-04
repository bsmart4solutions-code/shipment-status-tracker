/**
 * Pure invoice arithmetic, extracted from InvoicesService so the money math
 * can be unit-tested without a database. The service is responsible for
 * persistence and status-transition assertions; this module only computes.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Server-side totals. Tax and grand total are always derived here so a
 * client can never post an arbitrary total — only subtotal and taxPct are
 * trusted inputs.
 */
export function computeTotals(subtotal: number, taxPct: number): { taxAmt: number; totalAmount: number } {
  const taxAmt = round2(subtotal * (taxPct / 100));
  return { taxAmt, totalAmount: round2(subtotal + taxAmt) };
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
