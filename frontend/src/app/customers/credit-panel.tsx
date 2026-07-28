'use client';

/**
 * Customer credit standing (Sprint 04, P0-7).
 *
 * Shows what the customer owes against what they are allowed to owe, in the
 * company base currency. Enforcement is a hard block at invoice issue, so this
 * panel exists to make the decision visible *before* someone hits a refusal.
 */

import { useQuery } from '@tanstack/react-query';
import { Card, ErrorText, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/utils';

export interface CustomerCredit {
  customerId: string; customerName: string; baseCurrency: string;
  exposure: number; creditLimit: number | null; outstandingLimit: number | null;
  effectiveLimit: number | null; limitSource: 'creditLimit' | 'outstandingLimit' | 'both' | null;
  headroom: number | null; creditHold: boolean;
  outcome: 'ALLOW' | 'BLOCK'; reason: string | null; fxWarning: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  creditLimit: 'contractual credit limit',
  outstandingLimit: 'temporary operational limit',
  both: 'both limits (equal)',
};

export function CreditPanel({ customerId, customerName, onClose }: {
  customerId: string; customerName: string; onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['customer-credit', customerId],
    queryFn: () => api<CustomerCredit>(`/customers/${customerId}/credit`),
  });

  return (
    <Modal title={`Credit — ${customerName}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
        <ErrorText error={error} />

        {data && (
          <>
            {data.fxWarning && (
              <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                <span className="font-semibold">Exchange rate missing.</span> {data.fxWarning}
                <div className="mt-1 text-[12px]">
                  Credit cannot be evaluated until the rate is added, so invoice issue will be refused for this customer.
                </div>
              </div>
            )}

            {data.creditHold && (
              <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                <span className="font-semibold">On credit hold.</span> Invoices cannot be issued for this customer,
                whatever the balance, until the hold is lifted.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card className="!p-3">
                <div className="text-xs text-gray-500">Outstanding (exposure)</div>
                <div className="font-semibold">{fmtMoney(data.exposure, data.baseCurrency)}</div>
                <div className="text-[11px] text-gray-400">issued invoices − payments − credit notes + debit notes</div>
              </Card>

              <Card className="!p-3">
                <div className="text-xs text-gray-500">Effective limit</div>
                <div className="font-semibold">
                  {data.effectiveLimit === null ? 'No limit' : fmtMoney(data.effectiveLimit, data.baseCurrency)}
                </div>
                <div className="text-[11px] text-gray-400">
                  {data.effectiveLimit === null
                    ? 'no ceiling configured — never blocked'
                    : `from the ${SOURCE_LABEL[data.limitSource ?? ''] ?? 'limit'}`}
                </div>
              </Card>

              <Card className={`!p-3 ${data.outcome === 'BLOCK' ? '!border-red-300 !bg-red-50 dark:!bg-red-950/30' : '!bg-primary/5 dark:!bg-primary/10 !border-primary/20'}`}>
                <div className="text-xs text-gray-500">Headroom</div>
                <div className={`text-lg font-bold ${data.outcome === 'BLOCK' ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
                  {data.headroom === null ? '—' : fmtMoney(data.headroom, data.baseCurrency)}
                </div>
                <div className="text-[11px] text-gray-400">
                  {data.outcome === 'BLOCK' ? 'further invoices will be refused' : 'available before invoices are refused'}
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="text-gray-500">
                Contractual credit limit:{' '}
                <span className="text-gray-800 dark:text-gray-200 font-medium">
                  {data.creditLimit === null ? 'not set' : fmtMoney(data.creditLimit, data.baseCurrency)}
                </span>
              </div>
              <div className="text-gray-500">
                Temporary operational limit:{' '}
                <span className="text-gray-800 dark:text-gray-200 font-medium">
                  {data.outstandingLimit === null ? 'not set' : fmtMoney(data.outstandingLimit, data.baseCurrency)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-gray-400">
              All figures in {data.baseCurrency}. The tighter of the two limits applies; a limit left blank means
              <strong> no ceiling</strong>, never a ceiling of zero. Credit is enforced when an invoice is issued —
              quotations, jobs and payments are never blocked.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
