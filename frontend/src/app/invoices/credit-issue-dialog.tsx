'use client';

/**
 * Issuing a DRAFT invoice, with the customer's credit state shown BEFORE the
 * attempt so a hard block is never a surprise.
 *
 * Approved policy: issue is the only credit-gated action; a block is refused
 * outright unless an Administrator or Manager supplies an override reason.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { Card, ErrorText, Modal } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtMoney } from '@/lib/utils';

interface CreditCheck {
  decision: {
    outcome: 'ALLOW' | 'BLOCK';
    reason: 'CREDIT_HOLD' | 'LIMIT_EXCEEDED' | 'EXPOSURE_UNKNOWN' | null;
    exposure: number; effectiveLimit: number | null; projected: number;
    headroom: number | null; shortfall: number | null; creditHold: boolean;
  };
  baseCurrency: string;
  fxWarning: string | null;
  customerName: string;
  invoiceTotalBase: number;
}

export function CreditIssueDialog({ invoiceId, invoiceNumber, onClose }: {
  invoiceId: string; invoiceNumber: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const canOverride = hasPermission('credit.override');
  const [reason, setReason] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['invoice-credit-check', invoiceId],
    queryFn: () => api<CreditCheck>(`/invoices/${invoiceId}/credit-check`),
  });

  const issue = useMutation({
    mutationFn: (overrideReason?: string) => api(`/invoices/${invoiceId}/issue`, {
      method: 'POST',
      body: JSON.stringify(overrideReason ? { creditOverrideReason: overrideReason } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['customer-credit'] });
      onClose();
    },
  });

  const blocked = data?.decision.outcome === 'BLOCK';
  const ccy = data?.baseCurrency ?? 'MYR';

  return (
    <Modal title={`Issue ${invoiceNumber}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Checking credit…</p>}
        <ErrorText error={error} />

        {data && (
          <>
            <Card className={blocked
              ? '!p-4 !border-red-300 !bg-red-50 dark:!bg-red-950/30'
              : '!p-4 !bg-primary/5 dark:!bg-primary/10 !border-primary/20'}>
              <div className="flex items-start gap-3">
                {blocked && <ShieldAlert size={18} className="text-red-500 mt-0.5 shrink-0" />}
                <div className="flex-1">
                  <div className="text-sm font-semibold mb-2">
                    {blocked ? 'Credit check failed' : 'Credit check passed'} — {data.customerName}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><div className="text-xs text-gray-500">Outstanding</div>
                      <div className="font-medium">{fmtMoney(data.decision.exposure, ccy)}</div></div>
                    <div><div className="text-xs text-gray-500">This invoice</div>
                      <div className="font-medium">{fmtMoney(data.invoiceTotalBase, ccy)}</div></div>
                    <div><div className="text-xs text-gray-500">Projected</div>
                      <div className="font-medium">{fmtMoney(data.decision.projected, ccy)}</div></div>
                    <div><div className="text-xs text-gray-500">Effective limit</div>
                      <div className="font-medium">
                        {data.decision.effectiveLimit === null ? 'No limit' : fmtMoney(data.decision.effectiveLimit, ccy)}
                      </div></div>
                  </div>

                  {data.decision.reason === 'LIMIT_EXCEEDED' && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                      Over the limit by <strong>{fmtMoney(data.decision.shortfall ?? 0, ccy)}</strong>.
                    </p>
                  )}
                  {data.decision.reason === 'CREDIT_HOLD' && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                      This customer is on <strong>credit hold</strong> — invoices cannot be issued whatever the balance.
                    </p>
                  )}
                  {data.decision.reason === 'EXPOSURE_UNKNOWN' && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                      Credit cannot be evaluated: {data.fxWarning ?? 'an exchange rate is missing'}. Add the rate and try again.
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {blocked && canOverride && (
              <Card className="!p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Override this block
                </div>
                <p className="text-sm text-gray-500 mb-2">
                  Issuing anyway is recorded against your name with the figures above. A reason is required.
                </p>
                <input className="input" placeholder="Reason for overriding the credit block"
                  value={reason} onChange={(e) => setReason(e.target.value)} />
              </Card>
            )}

            {blocked && !canOverride && (
              <p className="text-sm text-gray-500">
                Only an Administrator or Manager can override a credit block. Ask them to review, or clear the
                outstanding balance first.
              </p>
            )}

            <ErrorText error={issue.error} />

            <button
              className={blocked ? 'btn-primary w-full justify-center !bg-red-600 hover:!bg-red-700' : 'btn-primary w-full justify-center'}
              disabled={issue.isPending || (blocked && (!canOverride || !reason.trim()))}
              onClick={() => issue.mutate(blocked ? reason.trim() : undefined)}>
              {issue.isPending ? 'Issuing…' : blocked ? 'Override and issue' : 'Issue invoice'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
