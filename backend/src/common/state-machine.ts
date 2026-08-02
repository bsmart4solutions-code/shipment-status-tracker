import { BadRequestException } from '@nestjs/common';

/**
 * Allowed status transitions per entity (same-status is always a no-op and
 * permitted). Without this, any status can be set to any other status —
 * e.g. a WON quotation already converted to a job could be flipped back to
 * DRAFT, or a CANCELLED quotation reopened — silently corrupting the
 * commercial trail. Enforced centrally so every write path (controller,
 * service, future automation) goes through the same rules.
 */

type QuotationStatus = 'DRAFT' | 'SENT' | 'WON' | 'LOST' | 'CANCELLED';
type JobStatus = 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

const QUOTATION_EDGES: Record<QuotationStatus, Set<QuotationStatus>> = {
  DRAFT: new Set(['DRAFT', 'SENT', 'WON', 'LOST', 'CANCELLED']),
  SENT: new Set(['SENT', 'DRAFT', 'WON', 'LOST', 'CANCELLED']),
  // Once WON (commercials copied to a job), only allow cancelling the deal —
  // not silently reverting to an editable state behind the job's back.
  WON: new Set(['WON', 'CANCELLED']),
  // A lost deal can be reopened for a fresh round of negotiation.
  LOST: new Set(['LOST', 'DRAFT']),
  CANCELLED: new Set(['CANCELLED']),
};

const JOB_EDGES: Record<JobStatus, Set<JobStatus>> = {
  OPEN: new Set(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'CANCELLED']),
  IN_PROGRESS: new Set(['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']),
  ON_HOLD: new Set(['ON_HOLD', 'OPEN', 'IN_PROGRESS', 'CANCELLED']),
  // Terminal-ish: a finished job can still be cancelled (e.g. billing
  // reversal) but shouldn't silently reopen into an active state.
  COMPLETED: new Set(['COMPLETED', 'CANCELLED']),
  CANCELLED: new Set(['CANCELLED']),
};

const INVOICE_EDGES: Record<InvoiceStatus, Set<InvoiceStatus>> = {
  DRAFT: new Set(['DRAFT', 'ISSUED', 'CANCELLED']),
  ISSUED: new Set(['ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']),
  PARTIALLY_PAID: new Set(['PARTIALLY_PAID', 'PAID', 'CANCELLED']),
  // Fully paid is terminal — a correction should be a credit note / reversal,
  // not silently reopening a settled invoice.
  PAID: new Set(['PAID']),
  CANCELLED: new Set(['CANCELLED']),
};

// Credit/Debit note lifecycle: DRAFT is editable; ISSUED is locked and has
// applied to AR; CANCELLED voids a draft/issued note (issued-with-effect
// reversal is handled in the service before allowing the cancel).
type AdjustmentStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';
const ADJUSTMENT_EDGES: Record<AdjustmentStatus, Set<AdjustmentStatus>> = {
  DRAFT: new Set(['DRAFT', 'ISSUED', 'CANCELLED']),
  ISSUED: new Set(['ISSUED', 'CANCELLED']),
  CANCELLED: new Set(['CANCELLED']),
};

// Vendor bill lifecycle (AP). DRAFT is editable; APPROVED is the posting event
// that makes the bill a payable; payments derive PARTIALLY_PAID / PAID; VOID
// nullifies a bill that carries no payments. VOID (not CANCELLED) is the
// accounting term for nullifying a posted payable — see
// AP_ARCHITECTURE_DECISION.md §2.2 for why AP deviates from the AR vocabulary.
export type VendorBillStatus = 'DRAFT' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

const VENDOR_BILL_EDGES: Record<VendorBillStatus, Set<VendorBillStatus>> = {
  DRAFT: new Set(['DRAFT', 'APPROVED', 'VOID']),
  APPROVED: new Set(['APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID']),
  // A bill with payments cannot be voided (guarded in the service), so the
  // only forward moves from here are further payments.
  PARTIALLY_PAID: new Set(['PARTIALLY_PAID', 'PAID']),
  PAID: new Set(['PAID']),
  VOID: new Set(['VOID']),
};

// Booking lifecycle (Sprint 06, P0-4). DRAFT is editable; CONFIRMED is the
// event that creates the shipment Job (and is therefore irreversible — a
// confirmed booking with a job behind it must be cancelled, never silently
// reopened for editing); CANCELLED is terminal.
export type BookingStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

const BOOKING_EDGES: Record<BookingStatus, Set<BookingStatus>> = {
  DRAFT: new Set(['DRAFT', 'CONFIRMED', 'CANCELLED']),
  CONFIRMED: new Set(['CONFIRMED', 'CANCELLED']),
  CANCELLED: new Set(['CANCELLED']),
};

/**
 * Operational milestones of a shipment. Unlike every other machine here these
 * are **strictly forward-only and single-step**: cargo cannot un-depart, and
 * skipping ahead would silently invent events that never happened. Correcting
 * a mistake is a business decision (cancel the file / log a manual tracking
 * note), not a status edit — the same reasoning that makes PAID terminal for
 * invoices.
 *
 * `null` is the starting point: a job has no milestone until it is booked.
 */
export type MilestoneStatus = 'BOOKED' | 'GATED_IN' | 'LOADED' | 'DEPARTED' | 'ARRIVED' | 'DELIVERED';

export const MILESTONE_SEQUENCE: MilestoneStatus[] = [
  'BOOKED', 'GATED_IN', 'LOADED', 'DEPARTED', 'ARRIVED', 'DELIVERED',
];

const MILESTONE_EDGES: Record<MilestoneStatus, Set<MilestoneStatus>> = {
  BOOKED: new Set(['BOOKED', 'GATED_IN']),
  GATED_IN: new Set(['GATED_IN', 'LOADED']),
  LOADED: new Set(['LOADED', 'DEPARTED']),
  DEPARTED: new Set(['DEPARTED', 'ARRIVED']),
  ARRIVED: new Set(['ARRIVED', 'DELIVERED']),
  DELIVERED: new Set(['DELIVERED']),
};

/**
 * Payment reversal is the ONLY operation that moves a bill backwards, so its
 * edges live in a separate set that only `reversePayment()` consults. There is
 * no generic "set status" endpoint, so backward transitions stay unreachable by
 * any other path — the capability is created deliberately and confined by
 * construction (AP_ARCHITECTURE_DECISION.md §11.3).
 */
const VENDOR_BILL_REVERSAL_EDGES: Record<string, Set<VendorBillStatus>> = {
  PAID: new Set(['PAID', 'PARTIALLY_PAID', 'APPROVED']),
  PARTIALLY_PAID: new Set(['PARTIALLY_PAID', 'APPROVED']),
  APPROVED: new Set(['APPROVED']),
};

export function assertQuotationStatusTransition(from: QuotationStatus, to: QuotationStatus): void {
  const allowed = QUOTATION_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Quotation status cannot change from ${from} to ${to}`);
  }
}

export function assertJobStatusTransition(from: JobStatus, to: JobStatus): void {
  const allowed = JOB_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Job status cannot change from ${from} to ${to}`);
  }
}

export function assertInvoiceStatusTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  const allowed = INVOICE_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Invoice status cannot change from ${from} to ${to}`);
  }
}

export function assertNoteStatusTransition(from: AdjustmentStatus, to: AdjustmentStatus): void {
  const allowed = ADJUSTMENT_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Note status cannot change from ${from} to ${to}`);
  }
}

export function assertVendorBillStatusTransition(from: VendorBillStatus, to: VendorBillStatus): void {
  const allowed = VENDOR_BILL_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Vendor bill status cannot change from ${from} to ${to}`);
  }
}

/** Backward transition, reachable only through payment reversal. */
export function assertVendorBillReversal(from: VendorBillStatus, to: VendorBillStatus): void {
  const allowed = VENDOR_BILL_REVERSAL_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Payment reversal cannot move a vendor bill from ${from} to ${to}`);
  }
}

export function assertBookingStatusTransition(from: BookingStatus, to: BookingStatus): void {
  const allowed = BOOKING_EDGES[from];
  if (!allowed?.has(to)) {
    throw new BadRequestException(`Booking status cannot change from ${from} to ${to}`);
  }
}

/**
 * `from` is null for a shipment that has not reached its first milestone yet,
 * in which case only BOOKED is reachable.
 */
export function assertMilestoneTransition(from: MilestoneStatus | null, to: MilestoneStatus): void {
  const allowed = from === null ? new Set<MilestoneStatus>(['BOOKED']) : MILESTONE_EDGES[from];
  if (!allowed?.has(to)) {
    const current = from ?? 'not yet booked';
    throw new BadRequestException(
      `Shipment milestone cannot move from ${current} to ${to} — milestones advance one step at a time and never go backwards`,
    );
  }
}
