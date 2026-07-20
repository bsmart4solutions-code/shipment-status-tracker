'use client';

/**
 * Shared Credit/Debit Note list — one implementation, two routes.
 * Loading / empty / error states + pagination + status filter, following the
 * invoices page pattern.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { NoteModal } from './note-form';

const STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'];

export interface NoteRow {
  id: string; noteNumber: string; type: 'CREDIT' | 'DEBIT'; status: string; currency: string;
  subtotal: string; taxAmt: string; totalAmount: string; reason: string | null; issueDate: string;
  customer: { companyName: string; code: string }; invoice: { invoiceNumber: string } | null;
}

export function NoteListPage({ type }: { type: 'CREDIT' | 'DEBIT' }) {
  const label = type === 'CREDIT' ? 'Credit Notes' : 'Debit Notes';
  const singular = type === 'CREDIT' ? 'Credit Note' : 'Debit Note';
  const printBase = type === 'CREDIT' ? '/credit-notes' : '/debit-notes';
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<NoteRow | 'new' | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['notes', type, page, search, status],
    queryFn: () => api<{ items: NoteRow[]; pageCount: number }>(
      `/credit-debit-notes?type=${type}&page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('invoices.write');
  const issue = useMutation({
    mutationFn: (id: string) => api(`/credit-debit-notes/${id}/issue`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/credit-debit-notes/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); },
  });

  return (
    <Shell title={label} actions={
      canWrite ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New {singular}</button> : undefined
    }>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder={`Search ${singular.toLowerCase()} #, invoice #, customer…`}
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[160px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {isLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
      <ErrorText error={error} />
      {!isLoading && !error && (
        <Table head={['Note #', 'Date', 'Customer', 'Against Invoice', 'Reason', 'Subtotal', 'Tax', 'Total', 'Status', '']}
          empty={data?.items.length === 0}>
          {data?.items.map((n) => (
            <tr key={n.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="td font-medium text-primary">{n.noteNumber}</td>
              <td className="td text-gray-500">{fmtDate(n.issueDate)}</td>
              <td className="td">{n.customer.companyName}</td>
              <td className="td text-gray-500">{n.invoice?.invoiceNumber ?? '-'}</td>
              <td className="td text-gray-500 max-w-[220px] truncate" title={n.reason ?? ''}>{n.reason ?? '-'}</td>
              <td className="td">{fmtMoney(n.subtotal, n.currency)}</td>
              <td className="td">{fmtMoney(n.taxAmt, n.currency)}</td>
              <td className="td font-medium">{fmtMoney(n.totalAmount, n.currency)}</td>
              <td className="td"><StatusBadge status={n.status} /></td>
              <td className="td">
                <div className="flex gap-2 flex-wrap justify-end">
                  {canWrite && n.status === 'DRAFT' && <button className="text-primary hover:underline text-sm" onClick={() => setEditing(n)}>Edit</button>}
                  {canWrite && n.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm"
                      onClick={() => { if (confirm(`Issue ${n.noteNumber} for ${fmtMoney(n.totalAmount, n.currency)}? This posts the ${singular.toLowerCase()} to the customer's account and locks it.`)) issue.mutate(n.id); }}>
                      Issue
                    </button>
                  )}
                  {n.status !== 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm inline-flex items-center gap-1" onClick={() => router.push(`${printBase}/${n.id}/print`)}>
                      <Printer size={13} /> Print
                    </button>
                  )}
                  {canWrite && n.status !== 'CANCELLED' && (
                    <button className="text-red-500 hover:underline text-sm"
                      onClick={() => {
                        // Voiding an ISSUED note reverses its AR effect — confirm it.
                        if (n.status === 'ISSUED' && !confirm(`Cancel ${n.noteNumber}? This voids an issued ${singular.toLowerCase()} and reverses its effect on the customer's account.`)) return;
                        cancel.mutate(n.id);
                      }}>
                      Cancel
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>
      <ErrorText error={issue.error || cancel.error} />

      {editing && <NoteModal type={type} note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Shell>
  );
}
