'use client';

/**
 * Accounts Payable — vendor bill list. Mirrors the invoices page pattern:
 * search + filters, loading / empty / error states, pagination, and row
 * actions gated on `payables.write`.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Wallet } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { exportToXlsx } from '@/lib/xlsx-export';
import { BillForm } from './bill-form';
import { PaymentDialog } from './payment-dialog';
import { ApAgingModal } from './ap-aging';

const BILL_STATUSES = ['DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

export interface BillRow {
  id: string; billNumber: string; vendorInvoiceNo: string; currency: string;
  subtotal: string; taxPct: string; taxAmt: string; totalAmount: string; amountPaid: string;
  outstanding: number; status: string; billDate: string; dueDate: string | null;
  vendorId: string; jobId: string | null;
  vendor: { name: string; code: string }; job: { jobNumber: string } | null;
}

export default function PayablesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<BillRow | 'new' | null>(null);
  const [paying, setPaying] = useState<BillRow | null>(null);
  const [showAging, setShowAging] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['payables', page, search, status],
    queryFn: () => api<{ items: BillRow[]; pageCount: number }>(
      `/payables?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('payables.write');

  const approve = useMutation({
    mutationFn: (id: string) => api(`/payables/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payables'] }),
  });
  const voidBill = useMutation({
    mutationFn: (id: string) => api(`/payables/${id}/void`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payables'] }),
  });

  // Finance reconciles AP against the vendor's own statement, so the export
  // carries the vendor invoice number and the outstanding balance, not just
  // our internal bill number.
  const exportXlsx = () => exportToXlsx('payables.xlsx', (data?.items ?? []).map((b) => ({
    'Bill #': b.billNumber, 'Vendor Invoice #': b.vendorInvoiceNo, Vendor: b.vendor.name,
    'Vendor Code': b.vendor.code, Job: b.job?.jobNumber ?? '',
    Currency: b.currency, Subtotal: Number(b.subtotal), Tax: Number(b.taxAmt),
    Total: Number(b.totalAmount), Paid: Number(b.amountPaid), Outstanding: Number(b.outstanding),
    'Bill Date': fmtDate(b.billDate), 'Due Date': fmtDate(b.dueDate), Status: b.status,
  })));

  return (
    <Shell title="Payables" actions={
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={exportXlsx}>Export Excel</button>
        <button className="btn-ghost" onClick={() => setShowAging(true)}><Clock size={15} /> AP Aging</button>
        {canWrite && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Bill</button>}
      </div>
    }>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder="Search bill #, vendor invoice #, vendor…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {BILL_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
      <ErrorText error={error} />
      {!isLoading && !error && (
        <Table head={['Bill #', 'Vendor Invoice #', 'Vendor', 'Job', 'Bill Date', 'Due Date', 'Total', 'Paid', 'Outstanding', 'Status', '']}
          empty={data?.items.length === 0}>
          {data?.items.map((b) => (
            <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="td font-medium text-primary">{b.billNumber}</td>
              <td className="td">{b.vendorInvoiceNo}</td>
              <td className="td">{b.vendor.name}</td>
              <td className="td text-gray-500">{b.job?.jobNumber ?? '-'}</td>
              <td className="td text-gray-500">{fmtDate(b.billDate)}</td>
              <td className="td text-gray-500">{b.dueDate ? fmtDate(b.dueDate) : '-'}</td>
              <td className="td">{fmtMoney(b.totalAmount, b.currency)}</td>
              <td className="td">{fmtMoney(b.amountPaid, b.currency)}</td>
              <td className="td font-medium">{fmtMoney(b.outstanding, b.currency)}</td>
              <td className="td"><StatusBadge status={b.status} /></td>
              <td className="td">
                <div className="flex gap-2 flex-wrap justify-end">
                  {canWrite && b.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm" onClick={() => setEditing(b)}>Edit</button>
                  )}
                  {canWrite && b.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm"
                      onClick={() => { if (confirm(`Approve ${b.billNumber} for ${fmtMoney(b.totalAmount, b.currency)}? This posts it as a payable to ${b.vendor.name}.`)) approve.mutate(b.id); }}>
                      Approve
                    </button>
                  )}
                  {(b.status === 'APPROVED' || b.status === 'PARTIALLY_PAID' || b.status === 'PAID') && (
                    <button className="text-primary hover:underline text-sm" onClick={() => setPaying(b)}>
                      {canWrite && b.status !== 'PAID' ? 'Pay' : 'Payments'}
                    </button>
                  )}
                  {canWrite && b.status !== 'VOID' && b.status !== 'PAID' && (
                    <button className="text-red-500 hover:underline text-sm"
                      onClick={() => { if (confirm(`Void ${b.billNumber}? This nullifies the bill. Bills with recorded payments must have those payments reversed first.`)) voidBill.mutate(b.id); }}>
                      Void
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>
      <ErrorText error={approve.error || voidBill.error} />

      {editing && <BillForm bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentDialog bill={paying} onClose={() => setPaying(null)} />}
      {showAging && <ApAgingModal onClose={() => setShowAging(false)} />}
    </Shell>
  );
}
