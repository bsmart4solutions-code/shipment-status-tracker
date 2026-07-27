'use client';

/**
 * Job cost panel (Sprint 03 Phase B). Four INDEPENDENT values — vendor bills
 * never overwrite the recorded cost, they are compared against it:
 *
 *   Estimated · Recorded · Vendor Bill Total · Variance
 *
 * Two honesty rules are deliberate, not cosmetic:
 *  - when the recorded cost is still the quotation estimate (jobs are seeded
 *    with it at conversion), say so instead of implying a confirmed figure;
 *  - with no bills yet the variance is "—", never 0.00: an absent measurement
 *    and a measured zero are different facts.
 */

import { useQuery } from '@tanstack/react-query';
import { Card, ErrorText, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

interface CostVariance {
  jobId: string; jobNumber: string; jobStatus: string; currency: string;
  estimatedCost: number | null; recordedCost: number; billedTotal: number;
  variance: number | null; billCount: number; latestBillDate: string | null;
  recordedIsUnconfirmed: boolean; billsMayBeOutstanding: boolean;
  fxWarning: string | null; fxIncomplete: boolean;
}

export function JobCostPanel({ jobId, jobNumber, onClose }: { jobId: string; jobNumber: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['job-cost-variance', jobId],
    queryFn: () => api<CostVariance>(`/jobs/${jobId}/cost-variance`),
  });

  const varianceTone = (v: number) =>
    v > 0.005 ? 'text-red-500' : v < -0.005 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600';

  return (
    <Modal title={`Cost — ${jobNumber}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
        <ErrorText error={error} />

        {data && (
          <>
            {data.fxWarning && (
              <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                <span className="font-semibold">Exchange rate missing.</span> {data.fxWarning}
                <div className="mt-1 text-[12px]">
                  The variance is hidden because the billed total mixes currencies that could not be converted.
                  Add the missing rate under Settings, then reopen this panel.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="!p-3">
                <div className="text-xs text-gray-500">Estimated Cost</div>
                <div className="font-semibold">
                  {data.estimatedCost === null ? '—' : fmtMoney(data.estimatedCost, data.currency)}
                </div>
                <div className="text-[11px] text-gray-400">
                  {data.estimatedCost === null ? 'no quotation linked' : 'from the quotation'}
                </div>
              </Card>

              <Card className="!p-3">
                <div className="text-xs text-gray-500">Recorded Cost</div>
                <div className="font-semibold">{fmtMoney(data.recordedCost, data.currency)}</div>
                <div className="text-[11px] text-gray-400">
                  {data.recordedIsUnconfirmed ? 'from quotation — not yet confirmed' : 'entered by operations'}
                </div>
              </Card>

              <Card className="!p-3">
                <div className="text-xs text-gray-500">Vendor Bill Total</div>
                <div className="font-semibold">{fmtMoney(data.billedTotal, data.currency)}</div>
                <div className="text-[11px] text-gray-400">
                  {data.billCount === 0
                    ? 'no bills yet'
                    : `${data.billCount} bill${data.billCount === 1 ? '' : 's'}${data.latestBillDate ? ` · latest ${fmtDate(data.latestBillDate)}` : ''}`}
                </div>
              </Card>

              <Card className="!p-3 !bg-primary/5 dark:!bg-primary/10 !border-primary/20">
                <div className="text-xs text-gray-500">Variance</div>
                <div className={`text-lg font-bold ${data.variance === null ? 'text-gray-400' : varianceTone(data.variance)}`}>
                  {data.variance === null ? '—' : fmtMoney(data.variance, data.currency)}
                </div>
                <div className="text-[11px] text-gray-400">billed − recorded</div>
              </Card>
            </div>

            <div className="text-sm space-y-1">
              {data.variance !== null && data.variance > 0.005 && (
                <p className="text-red-500">
                  Vendors have billed {fmtMoney(data.variance, data.currency)} more than the recorded cost — check the bills before this job is closed.
                </p>
              )}
              {data.variance !== null && data.variance < -0.005 && (
                <p className="text-amber-600 dark:text-amber-400">
                  Billed less than recorded so far{data.billsMayBeOutstanding ? ' — bills may still be outstanding.' : '.'}
                </p>
              )}
              {data.billCount === 0 && (
                <p className="text-gray-500">No vendor bills are allocated to this job yet, so there is nothing to compare.</p>
              )}
              {data.fxIncomplete && data.billCount > 0 && (
                <p className="text-red-500">
                  The vendor bill total above includes amounts that could not be converted, so it is not comparable to the recorded cost.
                </p>
              )}
              {data.billsMayBeOutstanding && data.billCount > 0 && (
                <p className="text-gray-500">
                  This job is {data.jobStatus} — carrier invoices often arrive after delivery, so the billed total may still grow.
                </p>
              )}
              {data.recordedIsUnconfirmed && (
                <p className="text-gray-500">
                  The recorded cost still equals the quotation estimate. It is seeded at conversion and has not been confirmed against actuals.
                </p>
              )}
            </div>

            <p className="text-[11px] text-gray-400">
              All figures in {data.currency}. Each foreign-currency bill is converted using the rate in effect on its own bill date,
              so these figures do not change when newer rates are added. Vendor bills never change the recorded cost or this job&apos;s profit.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
