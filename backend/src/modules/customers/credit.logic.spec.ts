import {
  assertCreditAllows, CreditBlockedError, creditBlockMessage, effectiveLimit, evaluateCredit,
} from './credit.logic';

/**
 * Sprint 04 / P0-7 — approved policy:
 *  D-1 hard block, no warning-only mode
 *  D-4 effective limit = MIN of the non-null limits; both null ⇒ no limit
 *  D-5 creditHold is an absolute stop
 *  D-8 all amounts already in base currency when they reach this module
 */

describe('effectiveLimit (D-4)', () => {
  it('takes the tighter of the two limits', () => {
    expect(effectiveLimit(10000, 4000)).toEqual({ limit: 4000, source: 'outstandingLimit' });
    expect(effectiveLimit(3000, 9000)).toEqual({ limit: 3000, source: 'creditLimit' });
  });

  it('reports "both" when the two limits are equal', () => {
    expect(effectiveLimit(5000, 5000)).toEqual({ limit: 5000, source: 'both' });
  });

  it('ignores a NULL outstandingLimit', () => {
    expect(effectiveLimit(7500, null)).toEqual({ limit: 7500, source: 'creditLimit' });
    expect(effectiveLimit(7500, undefined)).toEqual({ limit: 7500, source: 'creditLimit' });
  });

  it('uses outstandingLimit alone when creditLimit is NULL', () => {
    expect(effectiveLimit(null, 2000)).toEqual({ limit: 2000, source: 'outstandingLimit' });
  });

  it('treats both NULL as NO limit — never as zero', () => {
    expect(effectiveLimit(null, null)).toEqual({ limit: null, source: null });
    expect(effectiveLimit(undefined, undefined)).toEqual({ limit: null, source: null });
  });

  it('treats an explicit 0 as a real ceiling of zero', () => {
    expect(effectiveLimit(0, null)).toEqual({ limit: 0, source: 'creditLimit' });
  });
});

describe('evaluateCredit — limit enforcement (D-1)', () => {
  const base = { creditHold: false, outstandingLimit: null };

  it('allows when the projected total stays under the limit', () => {
    const d = evaluateCredit({ ...base, exposure: 3000, creditLimit: 10000, newInvoiceBase: 2000 });
    expect(d.outcome).toBe('ALLOW');
    expect(d.projected).toBe(5000);
    expect(d.headroom).toBe(5000);
  });

  it('allows at exactly the limit (boundary)', () => {
    const d = evaluateCredit({ ...base, exposure: 8000, creditLimit: 10000, newInvoiceBase: 2000 });
    expect(d.outcome).toBe('ALLOW');
    expect(d.headroom).toBe(0);
  });

  it('blocks one cent over the limit', () => {
    const d = evaluateCredit({ ...base, exposure: 8000, creditLimit: 10000, newInvoiceBase: 2000.01 });
    expect(d.outcome).toBe('BLOCK');
    expect(d.reason).toBe('LIMIT_EXCEEDED');
    expect(d.shortfall).toBe(0.01);
  });

  it('never returns a WARN outcome — there is no warning-only mode', () => {
    for (const newInvoiceBase of [0, 1, 5000, 999999]) {
      const d = evaluateCredit({ ...base, exposure: 5000, creditLimit: 6000, newInvoiceBase });
      expect(['ALLOW', 'BLOCK']).toContain(d.outcome);
    }
  });

  it('allows any amount when no limit is configured (null ≠ zero)', () => {
    const d = evaluateCredit({ exposure: 999_999, creditLimit: null, outstandingLimit: null, creditHold: false, newInvoiceBase: 500_000 });
    expect(d.outcome).toBe('ALLOW');
    expect(d.effectiveLimit).toBeNull();
    expect(d.headroom).toBeNull();
  });

  it('blocks everything when the limit is explicitly zero', () => {
    const d = evaluateCredit({ ...base, exposure: 0, creditLimit: 0, newInvoiceBase: 0.01 });
    expect(d.outcome).toBe('BLOCK');
  });

  it('enforces the tighter operational limit', () => {
    const d = evaluateCredit({ exposure: 4000, creditLimit: 10000, outstandingLimit: 4500, creditHold: false, newInvoiceBase: 1000 });
    expect(d.outcome).toBe('BLOCK');
    expect(d.effectiveLimit).toBe(4500);
    expect(d.limitSource).toBe('outstandingLimit');
  });
});

describe('evaluateCredit — credit hold (D-5)', () => {
  it('blocks even with a zero balance and a generous limit', () => {
    const d = evaluateCredit({ exposure: 0, creditLimit: 1_000_000, outstandingLimit: null, creditHold: true, newInvoiceBase: 1 });
    expect(d.outcome).toBe('BLOCK');
    expect(d.reason).toBe('CREDIT_HOLD');
  });

  it('blocks even when no limit is configured at all', () => {
    const d = evaluateCredit({ exposure: 0, creditLimit: null, outstandingLimit: null, creditHold: true, newInvoiceBase: 0 });
    expect(d.outcome).toBe('BLOCK');
    expect(d.reason).toBe('CREDIT_HOLD');
  });

  it('takes precedence over an exposure that could not be computed', () => {
    const d = evaluateCredit({ exposure: null, creditLimit: null, outstandingLimit: null, creditHold: true, newInvoiceBase: 0 });
    expect(d.reason).toBe('CREDIT_HOLD');
  });
});

describe('evaluateCredit — unknown exposure fails closed (D-8 / H-2 rule)', () => {
  it('blocks when exposure could not be computed', () => {
    const d = evaluateCredit({ exposure: null, creditLimit: 10000, outstandingLimit: null, creditHold: false, newInvoiceBase: 100 });
    expect(d.outcome).toBe('BLOCK');
    expect(d.reason).toBe('EXPOSURE_UNKNOWN');
  });

  it('blocks even when no limit is configured — an unevaluable check is not a pass', () => {
    const d = evaluateCredit({ exposure: null, creditLimit: null, outstandingLimit: null, creditHold: false, newInvoiceBase: 100 });
    expect(d.outcome).toBe('BLOCK');
    expect(d.reason).toBe('EXPOSURE_UNKNOWN');
  });
});

describe('assertCreditAllows and messaging', () => {
  const blocked = evaluateCredit({ exposure: 9000, creditLimit: 10000, outstandingLimit: null, creditHold: false, newInvoiceBase: 2000 });

  it('passes silently when allowed', () => {
    const ok = evaluateCredit({ exposure: 100, creditLimit: 10000, outstandingLimit: null, creditHold: false, newInvoiceBase: 100 });
    expect(() => assertCreditAllows(ok, 'MYR')).not.toThrow();
  });

  it('throws a typed error when blocked', () => {
    expect(() => assertCreditAllows(blocked, 'MYR')).toThrow(CreditBlockedError);
  });

  it('passes when a valid override is granted', () => {
    expect(() => assertCreditAllows(blocked, 'MYR', { granted: true })).not.toThrow();
  });

  it('still throws when an override was requested but not granted', () => {
    expect(() => assertCreditAllows(blocked, 'MYR', { granted: false })).toThrow(CreditBlockedError);
  });

  it('names the figures in the limit message', () => {
    const msg = creditBlockMessage(blocked, 'MYR');
    expect(msg).toContain('MYR 9000.00');   // outstanding
    expect(msg).toContain('MYR 11000.00');  // projected
    expect(msg).toContain('MYR 10000.00');  // limit
    expect(msg).toContain('MYR 1000.00');   // shortfall
  });

  it('explains credit hold and missing rates distinctly', () => {
    const hold = evaluateCredit({ exposure: 0, creditLimit: null, outstandingLimit: null, creditHold: true, newInvoiceBase: 0 });
    expect(creditBlockMessage(hold, 'MYR')).toMatch(/on credit hold/);
    const unknown = evaluateCredit({ exposure: null, creditLimit: null, outstandingLimit: null, creditHold: false, newInvoiceBase: 0 });
    expect(creditBlockMessage(unknown, 'MYR')).toMatch(/exchange rate is missing/);
  });
});
