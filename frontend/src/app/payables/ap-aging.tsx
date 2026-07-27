'use client';

/**
 * AP aging: outstanding payables bucketed by days overdue, plus per-vendor
 * totals. Mirrors the AR aging view.
 */

import { useQuery } from '@tanstack/react-query';
import { Card, ErrorText, Modal, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

interface AgingRow {
  id: string; billNumber: string; vendorInvoiceNo: string; vendor: string; currency: string;
  totalAmount: number; amountPaid: number; outstanding: number;
  dueDate: string | null; daysOverdue: number; bucket: string;
}
interface Aging {
  rows: AgingRow[];
  buckets: { label: string; count: number; total: number }[];
  byVendor: { vendor: string; count: number; total: number }[];
  totalPayable: number;
}

export function ApAgingModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['ap-aging'], queryFn: () => api<Aging>('/payables/aging') });

  return (
    <Modal title="AP Aging — what we owe" onClose={onClose} size="xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
        <ErrorText error={error} />

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {data.buckets.map((b) => (
                <Card key={b.label} className="!p-3">
                  <div className="text-xs text-gray-500">{b.label}</div>
                  <div className="font-semibold">{fmtMoney(b.total, 'MYR')}</div>
                  <div className="text-[11px] text-gray-400">{b.count} bill{b.count === 1 ? '' : 's'}</div>
                </Card>
              ))}
              <Card className="!p-3 !bg-primary/5 dark:!bg-primary/10 !border-primary/20">
                <div className="text-xs text-gray-500">Total payable</div>
                <div className="font-bold text-primary">{fmtMoney(data.totalPayable, 'MYR')}</div>
              </Card>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">By vendor</div>
              <Table head={['Vendor', 'Bills', 'Outstanding']} empty={data.byVendor.length === 0}>
                {data.byVendor.map((v) => (
                  <tr key={v.vendor}>
                    <td className="td">{v.vendor}</td>
                    <td className="td text-gray-500">{v.count}</td>
                    <td className="td font-medium">{fmtMoney(v.total, 'MYR')}</td>
                  </tr>
                ))}
              </Table>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Open bills</div>
              <div className="max-h-72 overflow-y-auto">
                <Table head={['Bill #', 'Vendor Invoice #', 'Vendor', 'Due Date', 'Days', 'Outstanding', 'Bucket']}
                  empty={data.rows.length === 0}>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="td font-medium text-primary">{r.billNumber}</td>
                      <td className="td">{r.vendorInvoiceNo}</td>
                      <td className="td">{r.vendor}</td>
                      <td className="td text-gray-500">{r.dueDate ? fmtDate(r.dueDate) : '-'}</td>
                      <td className={`td ${r.daysOverdue > 0 ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                        {r.daysOverdue > 0 ? `${r.daysOverdue} overdue` : '-'}
                      </td>
                      <td className="td font-medium">{fmtMoney(r.outstanding, r.currency)}</td>
                      <td className="td text-gray-500">{r.bucket}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
