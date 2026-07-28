/**
 * Customer credit control — pure decision logic (Sprint 04, P0-7).
 *
 * Deliberately shaped like `quotations/approval.logic.ts`: a pure evaluator
 * plus an explicit assertion, no I/O, fully unit-testable. All amounts are in
 * the company BASE currency (approved D-8); conversion happens before this
 * module is called.
 *
 * Approved policy:
 *  D-1  hard block — there is no warning-only mode and no WARN outcome
 *  D-4  effective limit = MIN of the non-null limits; both null ⇒ no limit
 *  D-5  creditHold is an absolute stop, regardless of balance
 *  D-9  per customer — there is no global limit or global toggle
 */

import { round2 } from '../invoices/invoice.calc';

export type CreditOutcome = 'ALLOW' | 'BLOCK';

export type CreditBlockReason =
  | 'CREDIT_HOLD'        // customer is on hold — absolute stop
  | 'LIMIT_EXCEEDED'     // projected exposure would exceed the effective limit
  | 'EXPOSURE_UNKNOWN';  // exposure could not be computed (missing FX rate)

export interface CreditDecision {
  outcome: CreditOutcome;
  reason: CreditBlockReason | null;
  /** Outstanding AR in base currency before this invoice. */
  exposure: number;
  /** MIN of the non-null limits; null means "no limit configured". */
  effectiveLimit: number | null;
  /** Which field produced the effective limit — for an honest UI. */
  limitSource: 'creditLimit' | 'outstandingLimit' | 'both' | null;
  /** Exposure + this invoice, in base currency. */
  projected: number;
  /** effectiveLimit − projected; null when there is no limit. */
  headroom: number | null;
  /** projected − effectiveLimit when blocked on limit, else null. */
  shortfall: number | null;
  creditHold: boolean;
}

/**
 * Effective ceiling from the two configured limits (D-4).
 *
 * `creditLimit` is the contractual ceiling, `outstandingLimit` a temporary
 * operational one; the tighter of the two governs. A NULL limit is **absence of
 * a ceiling, never a ceiling of zero** — the same principle the approval
 * threshold uses, so an unmaintained field can never silently freeze trading.
 * A limit explicitly set to 0 *is* a real ceiling of zero.
 */
export function effectiveLimit(
  creditLimit: number | null | undefined,
  outstandingLimit: number | null | undefined,
): { limit: number | null; source: CreditDecision['limitSource'] } {
  const hasCredit = creditLimit !== null && creditLimit !== undefined;
  const hasOutstanding = outstandingLimit !== null && outstandingLimit !== undefined;

  if (hasCredit && hasOutstanding) {
    const limit = Math.min(creditLimit as number, outstandingLimit as number);
    const source: CreditDecision['limitSource'] =
      creditLimit === outstandingLimit ? 'both' : (limit === creditLimit ? 'creditLimit' : 'outstandingLimit');
    return { limit: round2(limit), source };
  }
  if (hasCredit) return { limit: round2(creditLimit as number), source: 'creditLimit' };
  if (hasOutstanding) return { limit: round2(outstandingLimit as number), source: 'outstandingLimit' };
  return { limit: null, source: null };
}

export interface CreditInput {
  /** Outstanding AR in base currency, or null when it could not be computed. */
  exposure: number | null;
  creditLimit: number | null | undefined;
  outstandingLimit: number | null | undefined;
  creditHold: boolean;
  /** Value of the invoice being issued, in base currency. */
  newInvoiceBase: number;
}

/**
 * Decide whether issuing this invoice is permitted.
 *
 * Order matters: credit hold is checked first because it is absolute (D-5) and
 * must hold even when the balance is zero or exposure is unknown.
 */
export function evaluateCredit(input: CreditInput): CreditDecision {
  const { limit, source } = effectiveLimit(input.creditLimit, input.outstandingLimit);
  const exposure = input.exposure ?? 0;
  const projected = round2(exposure + input.newInvoiceBase);

  const base = {
    exposure: round2(exposure),
    effectiveLimit: limit,
    limitSource: source,
    projected,
    headroom: limit === null ? null : round2(limit - projected),
    shortfall: null as number | null,
    creditHold: input.creditHold,
  };

  // D-5 — absolute stop, evaluated before any arithmetic.
  if (input.creditHold) return { ...base, outcome: 'BLOCK', reason: 'CREDIT_HOLD' };

  // Fail closed: deciding on unconverted amounts would silently bypass the
  // control, and treating a missing rate as 1:1 is forbidden.
  if (input.exposure === null) {
    return { ...base, outcome: 'BLOCK', reason: 'EXPOSURE_UNKNOWN', headroom: null };
  }

  // No configured ceiling ⇒ no limit to exceed.
  if (limit === null) return { ...base, outcome: 'ALLOW', reason: null };

  if (projected > limit) {
    return { ...base, outcome: 'BLOCK', reason: 'LIMIT_EXCEEDED', shortfall: round2(projected - limit) };
  }
  return { ...base, outcome: 'ALLOW', reason: null };
}

/** Typed error so the service can map it to the right HTTP status. */
export class CreditBlockedError extends Error {
  constructor(public readonly decision: CreditDecision, message: string) {
    super(message);
    this.name = 'CreditBlockedError';
  }
}

/** Human-readable explanation naming the figures behind the decision. */
export function creditBlockMessage(decision: CreditDecision, currency: string): string {
  const money = (n: number) => `${currency} ${n.toFixed(2)}`;
  switch (decision.reason) {
    case 'CREDIT_HOLD':
      return 'This customer is on credit hold — invoices cannot be issued until the hold is lifted';
    case 'EXPOSURE_UNKNOWN':
      return 'Credit cannot be evaluated because an exchange rate is missing for one of this customer\'s invoices — add the rate and try again';
    case 'LIMIT_EXCEEDED':
      return `Credit limit exceeded: outstanding ${money(decision.exposure)} plus this invoice `
        + `${money(round2(decision.projected - decision.exposure))} is ${money(decision.projected)}, `
        + `over the ${money(decision.effectiveLimit as number)} limit by ${money(decision.shortfall as number)}`;
    default:
      return 'Credit check failed';
  }
}

/**
 * Throws unless the decision allows, or a valid override is supplied.
 * The caller is responsible for verifying the override permission first —
 * this function only enforces that an override was actually granted.
 */
export function assertCreditAllows(
  decision: CreditDecision,
  currency: string,
  override?: { granted: boolean },
): void {
  if (decision.outcome === 'ALLOW') return;
  if (override?.granted) return;
  throw new CreditBlockedError(decision, creditBlockMessage(decision, currency));
}
