import {
  assertInvoiceStatusTransition,
  assertJobStatusTransition,
  assertQuotationStatusTransition,
} from './state-machine';

describe('State machine — quotation transitions', () => {
  it('allows the normal DRAFT → SENT → WON path', () => {
    expect(() => assertQuotationStatusTransition('DRAFT', 'SENT')).not.toThrow();
    expect(() => assertQuotationStatusTransition('SENT', 'WON')).not.toThrow();
  });

  it('allows same-status no-ops', () => {
    for (const s of ['DRAFT', 'SENT', 'WON', 'LOST', 'CANCELLED'] as const) {
      expect(() => assertQuotationStatusTransition(s, s)).not.toThrow();
    }
  });

  it('blocks reverting a WON quote to an editable state (only CANCELLED allowed)', () => {
    expect(() => assertQuotationStatusTransition('WON', 'DRAFT')).toThrow(/cannot change from WON to DRAFT/);
    expect(() => assertQuotationStatusTransition('WON', 'SENT')).toThrow();
    expect(() => assertQuotationStatusTransition('WON', 'CANCELLED')).not.toThrow();
  });

  it('treats CANCELLED as terminal', () => {
    for (const to of ['DRAFT', 'SENT', 'WON', 'LOST'] as const) {
      expect(() => assertQuotationStatusTransition('CANCELLED', to)).toThrow();
    }
  });

  it('lets a LOST deal reopen to DRAFT for renegotiation', () => {
    expect(() => assertQuotationStatusTransition('LOST', 'DRAFT')).not.toThrow();
    expect(() => assertQuotationStatusTransition('LOST', 'WON')).toThrow();
  });
});

describe('State machine — job transitions', () => {
  it('allows OPEN → IN_PROGRESS → COMPLETED', () => {
    expect(() => assertJobStatusTransition('OPEN', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertJobStatusTransition('IN_PROGRESS', 'COMPLETED')).not.toThrow();
  });

  it('supports ON_HOLD in both directions', () => {
    expect(() => assertJobStatusTransition('IN_PROGRESS', 'ON_HOLD')).not.toThrow();
    expect(() => assertJobStatusTransition('ON_HOLD', 'IN_PROGRESS')).not.toThrow();
  });

  it('does not silently reopen a COMPLETED job (only CANCELLED allowed)', () => {
    expect(() => assertJobStatusTransition('COMPLETED', 'IN_PROGRESS')).toThrow();
    expect(() => assertJobStatusTransition('COMPLETED', 'OPEN')).toThrow();
    expect(() => assertJobStatusTransition('COMPLETED', 'CANCELLED')).not.toThrow();
  });

  it('cannot skip OPEN straight to COMPLETED', () => {
    expect(() => assertJobStatusTransition('OPEN', 'COMPLETED')).toThrow();
  });

  it('treats CANCELLED as terminal', () => {
    for (const to of ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'] as const) {
      expect(() => assertJobStatusTransition('CANCELLED', to)).toThrow();
    }
  });
});

describe('State machine — invoice transitions', () => {
  it('allows DRAFT → ISSUED → PARTIALLY_PAID → PAID', () => {
    expect(() => assertInvoiceStatusTransition('DRAFT', 'ISSUED')).not.toThrow();
    expect(() => assertInvoiceStatusTransition('ISSUED', 'PARTIALLY_PAID')).not.toThrow();
    expect(() => assertInvoiceStatusTransition('PARTIALLY_PAID', 'PAID')).not.toThrow();
  });

  it('allows ISSUED to jump straight to PAID (paid in full)', () => {
    expect(() => assertInvoiceStatusTransition('ISSUED', 'PAID')).not.toThrow();
  });

  it('cannot record a payment path on a DRAFT invoice', () => {
    expect(() => assertInvoiceStatusTransition('DRAFT', 'PARTIALLY_PAID')).toThrow();
    expect(() => assertInvoiceStatusTransition('DRAFT', 'PAID')).toThrow();
  });

  it('treats PAID as terminal — no reopening a settled invoice', () => {
    for (const to of ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'CANCELLED'] as const) {
      expect(() => assertInvoiceStatusTransition('PAID', to)).toThrow();
    }
    expect(() => assertInvoiceStatusTransition('PAID', 'PAID')).not.toThrow();
  });

  it('can cancel from any pre-paid state but not from PAID', () => {
    expect(() => assertInvoiceStatusTransition('DRAFT', 'CANCELLED')).not.toThrow();
    expect(() => assertInvoiceStatusTransition('ISSUED', 'CANCELLED')).not.toThrow();
    expect(() => assertInvoiceStatusTransition('PARTIALLY_PAID', 'CANCELLED')).not.toThrow();
    expect(() => assertInvoiceStatusTransition('PAID', 'CANCELLED')).toThrow();
  });
});
