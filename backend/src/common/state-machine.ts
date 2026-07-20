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
