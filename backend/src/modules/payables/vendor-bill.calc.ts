/**
 * Pure arithmetic for vendor bills (AP). Deliberately thin: line pricing and
 * SST/SVE-aware totalling delegate to the invoice engine so AP tax maths is
 * *identical* to AR's — there is only one implementation, so the two can never
 * drift (AP_ARCHITECTURE_DECISION.md §6 decision 3).
 *
 * SST on a purchase is a COST, never recoverable input tax (PO Decision 6):
 * `taxAmt` is simply part of what is owed. No recoverable-tax concept exists
 * anywhere in this module by design.
 */

import {
  applyPayment, computeInvoiceTotals, priceInvoiceItem, round2,
  PricedInvoiceItem, PaymentOutcome,
} from '../invoices/invoice.calc';
import { VendorBillStatus } from '../../common/state-machine';

export interface VendorBillItemInput {
  unitPrice: number;
  quantity: number;
  fxRate?: number;     // lineCurrency -> bill currency (default 1)
  taxExempt?: boolean; // SVE 0% line (e.g. ocean freight)
}

/** Price bill lines and roll up to totals — reuses the invoice engine 1:1. */
export function computeVendorBillTotals(items: VendorBillItemInput[], taxPct: number) {
  const priced: PricedInvoiceItem[] = items.map((i) =>
    priceInvoiceItem({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt }),
  );
  const totals = computeInvoiceTotals(priced, taxPct);
  return { priced, ...totals };
}

/** Statuses in which a bill is a live payable (counts toward AP outstanding). */
export const LIVE_PAYABLE_STATUSES: VendorBillStatus[] = ['APPROVED', 'PARTIALLY_PAID'];

/**
 * Outstanding on one bill. The single owner of this formula: aging, the list
 * screen and the payment guard all call this rather than re-deriving it (the
 * M-10 lesson, applied from day one). DRAFT and VOID bills owe nothing.
 */
export function outstandingOfBill(bill: { totalAmount: number; amountPaid: number; status: VendorBillStatus }): number {
  if (!LIVE_PAYABLE_STATUSES.includes(bill.status)) return 0;
  return round2(bill.totalAmount - bill.amountPaid);
}

/**
 * Apply a payment to a vendor bill. Reuses the AR payment algorithm hardened in
 * Sprint 01A, so overpayment rejection and PAID derivation behave identically on
 * both sides of the ledger. `noteNet` is 0 today (vendor credit notes are
 * deferred, PO Decision 4) — the parameter already exists, so vendor notes plug
 * in later with no signature change.
 */
export function applyVendorPayment(totalAmount: number, amountPaid: number, paymentAmount: number): PaymentOutcome {
  return applyPayment(totalAmount, amountPaid, paymentAmount, 0);
}

export class AlreadyReversedError extends Error {
  constructor() {
    super('This payment has already been reversed');
    this.name = 'AlreadyReversedError';
  }
}

export interface ReversalOutcome {
  newAmountPaid: number;
  newStatus: VendorBillStatus;
}

/**
 * Recompute a bill after one of its payments is reversed.
 *
 * `remainingPaid` is the sum of the bill's NON-reversed payments *after* the
 * reversal. Status is re-derived, never set by a caller:
 *   0                        -> APPROVED
 *   0 < paid < totalAmount   -> PARTIALLY_PAID
 *   paid >= totalAmount      -> PAID  (partial reversal of an over-covered bill)
 */
export function recomputeAfterReversal(totalAmount: number, remainingPaid: number): ReversalOutcome {
  const newAmountPaid = round2(remainingPaid);
  if (newAmountPaid <= 0) return { newAmountPaid: 0, newStatus: 'APPROVED' };
  if (newAmountPaid >= round2(totalAmount)) return { newAmountPaid, newStatus: 'PAID' };
  return { newAmountPaid, newStatus: 'PARTIALLY_PAID' };
}
