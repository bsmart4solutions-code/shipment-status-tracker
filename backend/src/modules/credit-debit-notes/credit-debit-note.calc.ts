/**
 * Pure arithmetic for credit/debit notes. Deliberately thin — it delegates
 * line pricing and SST/SVE-aware totalling to the invoice engine so a note's
 * tax math is *identical* to the invoice it adjusts (no duplicated tax logic).
 * The only note-specific rule is the over-credit guard.
 */

import { priceInvoiceItem, computeInvoiceTotals, round2, PricedInvoiceItem } from '../invoices/invoice.calc';

export interface NoteItemInput {
  unitPrice: number;
  quantity: number;
  fxRate?: number;
  taxExempt?: boolean;
}

/** Price note lines and roll up to totals — reuses the invoice engine 1:1. */
export function computeNoteTotals(items: NoteItemInput[], taxPct: number) {
  const priced: PricedInvoiceItem[] = items.map((i) =>
    priceInvoiceItem({ unitPrice: i.unitPrice, quantity: i.quantity, fxRate: i.fxRate, taxExempt: i.taxExempt }),
  );
  const totals = computeInvoiceTotals(priced, taxPct);
  return { priced, ...totals };
}

export class OverCreditError extends Error {
  constructor(public readonly noteTotal: number, public readonly available: number) {
    super(`Credit note total ${round2(noteTotal)} exceeds the invoice's creditable balance of ${round2(available)}`);
    this.name = 'OverCreditError';
  }
}

/**
 * A CREDIT note cannot credit more than the invoice's *unpaid* remainder:
 * invoice total minus payments already received minus credit notes already
 * issued against it. Crediting cash the customer has already paid would
 * create a customer credit balance, which this system does not ledger yet
 * (credit-on-account against paid amounts is deferred to the SOA work).
 * All figures are tax-inclusive grand totals in the invoice currency.
 */
export function assertWithinCreditable(noteTotal: number, invoiceTotal: number, alreadyCredited: number, amountPaid = 0): void {
  const available = round2(invoiceTotal - amountPaid - alreadyCredited);
  if (round2(noteTotal) > available + 1e-6) {
    throw new OverCreditError(noteTotal, available);
  }
}
