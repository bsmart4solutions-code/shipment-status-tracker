import { BadRequestException } from '@nestjs/common';

export type ApprovalState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Approval gate for quotations. A quotation whose selling price (converted to
 * the base currency) reaches the configured threshold needs a manager's
 * approval before it can be sent to the customer or converted to a job.
 *
 * Threshold semantics: 0 / unset disables approvals entirely (the default) —
 * an ERP must never silently block commercial flow because nobody configured
 * a setting. Configure via SettingKV key "approval.quotation.thresholdBase".
 */
export function requiredApprovalStatus(sellingPriceBase: number, threshold: number): 'NOT_REQUIRED' | 'PENDING' {
  if (!Number.isFinite(threshold) || threshold <= 0) return 'NOT_REQUIRED';
  return sellingPriceBase >= threshold ? 'PENDING' : 'NOT_REQUIRED';
}

/**
 * Commercial actions gated by approval: sending the quote to the customer
 * (SENT) and winning/converting it (WON). Draft edits and cancelling stay
 * allowed regardless.
 */
export function assertApprovalAllows(action: 'SENT' | 'WON', approvalStatus: ApprovalState): void {
  if (approvalStatus === 'PENDING') {
    throw new BadRequestException(
      `Quotation is awaiting approval and cannot be ${action === 'SENT' ? 'sent' : 'won/converted'} yet`,
    );
  }
  if (approvalStatus === 'REJECTED') {
    throw new BadRequestException(
      'Quotation was rejected by the approver — revise it (which re-triggers approval) before proceeding',
    );
  }
}
