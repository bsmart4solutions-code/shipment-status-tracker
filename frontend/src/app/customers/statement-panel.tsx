'use client';

/**
 * Statement of Account (Sprint 05, P0-8).
 *
 * Chronological ledger of a customer's invoices, issued credit/debit notes and
 * payments, with a running balance. The authoritative closing figure is
 * `baseCurrencyExposure` — the same primitive AR aging and credit control use
 * — so this view can never disagree with what credit control sees.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { ErrorText, Modal, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/utils';
import { EmailDialog } from '@/components/email-dialog';

interface StatementRow {
  date: string; type: string; ref: string; currency: string; debit: number; credit: number; balance: number;
}
interface Statement {
  customer: { id: string; name: string; code: string; email: string | null; currency: string | null };
  asOfDate: string; rows: StatementRow[]; mixedCurrency: boolean;
  nativeClosingBalance: number; baseCurrencyExposure: number; fxWarning: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice', PAYMENT: 'Payment', CREDIT_NOTE: 'Credit Note', DEBIT_NOTE: 'Debit Note',
};

export function StatementPanel({ customerId, customerName, onClose }: {
  customerId: string; customerName: string; onClose: () => void;
}) {
  const [emailing, setEmailing] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['customer-statement', customerId],
    queryFn: () => api<Statement>(`/customers/${customerId}/statement`),
  });

  return (
    <Modal title={`Statement of Account — ${customerName}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
        <ErrorText error={error} />

        {data && (
          <>
            {data.fxWarning && (
              <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                <span className="font-semibold">Exchange rate missing.</span> {data.fxWarning}
              </div>
            )}
            {data.mixedCurrency && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 p-3 text-sm text-amber-700 dark:text-amber-300">
                This customer has invoices in more than one currency — the running balance below is a native-currency
                convenience figure only. The base-currency exposure below is the authoritative balance.
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">As of {new Date(data.asOfDate).toISOString().slice(0, 10)}</div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Closing balance (base currency)</div>
                <div className="text-lg font-bold text-primary">{fmtMoney(data.baseCurrencyExposure)}</div>
              </div>
            </div>

            <Table head={['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance']} empty={data.rows.length === 0}>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className="td text-gray-500">{r.date.slice(0, 10)}</td>
                  <td className="td">{TYPE_LABEL[r.type] ?? r.type}</td>
                  <td className="td font-medium text-primary">{r.ref}</td>
                  <td className="td text-right">{r.debit ? fmtMoney(r.debit, r.currency) : ''}</td>
                  <td className="td text-right text-emerald-600">{r.credit ? fmtMoney(r.credit, r.currency) : ''}</td>
                  <td className="td text-right font-medium">{fmtMoney(r.balance, r.currency)}</td>
                </tr>
              ))}
            </Table>

            <button className="btn-primary w-full justify-center" onClick={() => setEmailing(true)}>
              <Mail size={15} /> Email Statement
            </button>
          </>
        )}

        {emailing && (
          <EmailDialog title={`Email statement — ${customerName}`} endpoint={`/customers/${customerId}/statement/email`} onClose={() => setEmailing(false)} />
        )}
      </div>
    </Modal>
  );
}
