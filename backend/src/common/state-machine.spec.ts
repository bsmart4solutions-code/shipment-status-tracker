import {
  assertBookingStatusTransition,
  assertInvoiceStatusTransition,
  assertJobStatusTransition,
  assertMilestoneTransition,
  assertQuotationStatusTransition,
  assertVendorBillReversal,
  assertVendorBillStatusTransition,
  MILESTONE_SEQUENCE,
  MilestoneStatus,
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

describe('State machine — vendor bill transitions (AP)', () => {
  it('allows the normal DRAFT → APPROVED → PARTIALLY_PAID → PAID path', () => {
    expect(() => assertVendorBillStatusTransition('DRAFT', 'APPROVED')).not.toThrow();
    expect(() => assertVendorBillStatusTransition('APPROVED', 'PARTIALLY_PAID')).not.toThrow();
    expect(() => assertVendorBillStatusTransition('PARTIALLY_PAID', 'PAID')).not.toThrow();
    expect(() => assertVendorBillStatusTransition('APPROVED', 'PAID')).not.toThrow();
  });

  it('allows voiding only before any payment has landed', () => {
    expect(() => assertVendorBillStatusTransition('DRAFT', 'VOID')).not.toThrow();
    expect(() => assertVendorBillStatusTransition('APPROVED', 'VOID')).not.toThrow();
    // Once payments exist the bill has left APPROVED — voiding is not a legal
    // forward move (the service also blocks it with a 409).
    expect(() => assertVendorBillStatusTransition('PARTIALLY_PAID', 'VOID')).toThrow();
    expect(() => assertVendorBillStatusTransition('PAID', 'VOID')).toThrow();
  });

  it('cannot skip approval — a DRAFT bill is not payable', () => {
    expect(() => assertVendorBillStatusTransition('DRAFT', 'PARTIALLY_PAID')).toThrow();
    expect(() => assertVendorBillStatusTransition('DRAFT', 'PAID')).toThrow();
  });

  it('treats PAID and VOID as terminal in the forward direction', () => {
    for (const to of ['DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'VOID'] as const) {
      expect(() => assertVendorBillStatusTransition('PAID', to)).toThrow();
    }
    for (const to of ['DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID'] as const) {
      expect(() => assertVendorBillStatusTransition('VOID', to)).toThrow();
    }
  });

  it('never allows a bill to return to DRAFT once approved', () => {
    expect(() => assertVendorBillStatusTransition('APPROVED', 'DRAFT')).toThrow();
    expect(() => assertVendorBillStatusTransition('PARTIALLY_PAID', 'DRAFT')).toThrow();
  });
});

// Payment reversal is the ONLY backward move, and it lives in its own edge set
// so it can never be reached through the forward assertion.
describe('State machine — vendor bill payment reversal', () => {
  it('allows the backward moves reversal needs', () => {
    expect(() => assertVendorBillReversal('PAID', 'PARTIALLY_PAID')).not.toThrow();
    expect(() => assertVendorBillReversal('PAID', 'APPROVED')).not.toThrow();
    expect(() => assertVendorBillReversal('PARTIALLY_PAID', 'APPROVED')).not.toThrow();
    expect(() => assertVendorBillReversal('PAID', 'PAID')).not.toThrow();
  });

  it('is the only path to those backward moves — the forward set forbids them', () => {
    expect(() => assertVendorBillStatusTransition('PAID', 'PARTIALLY_PAID')).toThrow();
    expect(() => assertVendorBillStatusTransition('PAID', 'APPROVED')).toThrow();
    expect(() => assertVendorBillStatusTransition('PARTIALLY_PAID', 'APPROVED')).toThrow();
  });

  it('never lets reversal resurrect a DRAFT or void a bill', () => {
    expect(() => assertVendorBillReversal('PAID', 'DRAFT')).toThrow();
    expect(() => assertVendorBillReversal('PAID', 'VOID')).toThrow();
    expect(() => assertVendorBillReversal('APPROVED', 'DRAFT')).toThrow();
  });
});

describe('State machine — booking transitions (Sprint 06)', () => {
  it('allows the normal DRAFT → CONFIRMED path', () => {
    expect(() => assertBookingStatusTransition('DRAFT', 'CONFIRMED')).not.toThrow();
  });

  it('allows same-status no-ops', () => {
    for (const s of ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const) {
      expect(() => assertBookingStatusTransition(s, s)).not.toThrow();
    }
  });

  it('never reopens a CONFIRMED booking for editing — a job exists behind it', () => {
    expect(() => assertBookingStatusTransition('CONFIRMED', 'DRAFT')).toThrow(/cannot change from CONFIRMED to DRAFT/);
  });

  it('can still cancel a confirmed booking', () => {
    expect(() => assertBookingStatusTransition('CONFIRMED', 'CANCELLED')).not.toThrow();
  });

  it('treats CANCELLED as terminal', () => {
    for (const to of ['DRAFT', 'CONFIRMED'] as const) {
      expect(() => assertBookingStatusTransition('CANCELLED', to)).toThrow();
    }
  });
});

describe('State machine — shipment milestones (Sprint 06)', () => {
  it('walks the full sequence one step at a time', () => {
    expect(() => assertMilestoneTransition(null, 'BOOKED')).not.toThrow();
    for (let i = 0; i < MILESTONE_SEQUENCE.length - 1; i++) {
      expect(() => assertMilestoneTransition(MILESTONE_SEQUENCE[i], MILESTONE_SEQUENCE[i + 1])).not.toThrow();
    }
  });

  it('allows same-milestone no-ops', () => {
    for (const m of MILESTONE_SEQUENCE) {
      expect(() => assertMilestoneTransition(m, m)).not.toThrow();
    }
  });

  it('starts only at BOOKED — a shipment cannot begin mid-journey', () => {
    for (const to of ['GATED_IN', 'LOADED', 'DEPARTED', 'ARRIVED', 'DELIVERED'] as const) {
      expect(() => assertMilestoneTransition(null, to)).toThrow(/not yet booked/);
    }
  });

  it('never skips a step forward', () => {
    expect(() => assertMilestoneTransition('BOOKED', 'LOADED')).toThrow(/one step at a time/);
    expect(() => assertMilestoneTransition('BOOKED', 'DELIVERED')).toThrow();
    expect(() => assertMilestoneTransition('LOADED', 'ARRIVED')).toThrow();
  });

  it('never goes backwards — cargo cannot un-depart', () => {
    expect(() => assertMilestoneTransition('DEPARTED', 'LOADED')).toThrow(/never go backwards/);
    expect(() => assertMilestoneTransition('ARRIVED', 'BOOKED')).toThrow();
    expect(() => assertMilestoneTransition('DELIVERED', 'ARRIVED')).toThrow();
  });

  it('treats DELIVERED as terminal', () => {
    for (const to of MILESTONE_SEQUENCE.filter((m) => m !== 'DELIVERED') as MilestoneStatus[]) {
      expect(() => assertMilestoneTransition('DELIVERED', to)).toThrow();
    }
  });
});
