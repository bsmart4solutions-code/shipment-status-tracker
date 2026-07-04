'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Modal, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];

interface InvoiceRow {
  id: string; invoiceNumber: string; currency: string; subtotal: string; taxPct: string; taxAmt: string;
  totalAmount: string; amountPaid: string; status: string; issueDate: string; dueDate: string | null;
  notes: string | null; customerId: string; jobId: string | null;
  customer: { companyName: string; code: string }; job: { jobNumber: string } | null;
}

export default function InvoicesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<InvoiceRow | 'new' | null>(null);
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  const [showAging, setShowAging] = useState(false);

  const { data } = useQuery({
    queryKey: ['invoices', page, search, status],
    queryFn: () => api<{ items: InvoiceRow[]; pageCount: number }>(
      `/invoices?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('invoices.write');

  const issue = useMutation({
    mutationFn: (id: string) => api(`/invoices/${id}/issue`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/invoices/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });

  return (
    <Shell title="Invoices" actions={
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setShowAging(true)}><Clock size={15} /> Aging Report</button>
        {canWrite && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Invoice</button>}
      </div>
    }>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder="Search invoice #, customer…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[170px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <Table head={['Invoice #', 'Customer', 'Job', 'Total', 'Paid', 'Balance', 'Due Date', 'Status', '']} empty={data?.items.length === 0}>
        {data?.items.map((inv) => {
          const balance = Number(inv.totalAmount) - Number(inv.amountPaid);
          return (
            <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="td font-medium text-primary">{inv.invoiceNumber}</td>
              <td className="td">{inv.customer.companyName}</td>
              <td className="td text-gray-500">{inv.job?.jobNumber ?? '-'}</td>
              <td className="td">{fmtMoney(inv.totalAmount, inv.currency)}</td>
              <td className="td text-emerald-600">{fmtMoney(inv.amountPaid, inv.currency)}</td>
              <td className={`td font-medium ${balance > 0 ? 'text-red-500' : ''}`}>{fmtMoney(balance, inv.currency)}</td>
              <td className="td text-gray-500">{fmtDate(inv.dueDate)}</td>
              <td className="td"><StatusBadge status={inv.status} /></td>
              <td className="td">
                <div className="flex gap-2 flex-wrap justify-end">
                  {canWrite && inv.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm" onClick={() => setEditing(inv)}>Edit</button>
                  )}
                  {canWrite && inv.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm" onClick={() => issue.mutate(inv.id)}>Issue</button>
                  )}
                  {canWrite && (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') && (
                    <button className="text-primary hover:underline text-sm" onClick={() => setPaying(inv)}>Record Payment</button>
                  )}
                  {canWrite && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                    <button className="text-red-500 hover:underline text-sm" onClick={() => cancel.mutate(inv.id)}>Cancel</button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>
      <ErrorText error={issue.error || cancel.error} />

      {editing && <InvoiceModal invoice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentModal invoice={paying} onClose={() => setPaying(null)} />}
      {showAging && <AgingModal onClose={() => setShowAging(false)} />}
    </Shell>
  );
}

function InvoiceModal({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    customerId: invoice?.customerId ?? '',
    jobId: invoice?.jobId ?? '',
    currency: invoice?.currency ?? 'MYR',
    subtotal: invoice ? Number(invoice.subtotal) : 0,
    taxPct: invoice ? Number(invoice.taxPct) : 0,
    dueDate: invoice?.dueDate?.slice(0, 10) ?? '',
    notes: invoice?.notes ?? '',
  });

  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api<{ items: { id: string; companyName: string }[] }>('/customers?pageSize=200') });
  const { data: jobs } = useQuery({ queryKey: ['jobs-all'], queryFn: () => api<{ items: { id: string; jobNumber: string }[] }>('/jobs?pageSize=200') });

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, jobId: form.jobId || undefined, dueDate: form.dueDate || undefined };
      return invoice
        ? api(`/invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/invoices', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); onClose(); },
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const taxAmt = form.subtotal * (form.taxPct / 100);
  const total = form.subtotal + taxAmt;

  return (
    <Modal title={invoice ? `Edit ${invoice.invoiceNumber}` : 'New Invoice'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Customer</label>
            <select className="input" value={form.customerId} onChange={(e) => set('customerId', e.target.value)} required>
              <option value="">— select —</option>
              {customers?.items.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select></div>
          <div><label className="label">Linked Job (optional)</label>
            <select className="input" value={form.jobId} onChange={(e) => set('jobId', e.target.value)}>
              <option value="">— none —</option>
              {jobs?.items.map((j) => <option key={j.id} value={j.id}>{j.jobNumber}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Subtotal</label>
            <input className="input" type="number" step="0.01" value={form.subtotal} onChange={(e) => set('subtotal', Number(e.target.value))} /></div>
          <div><label className="label">Tax %</label>
            <input className="input" type="number" step="0.01" value={form.taxPct} onChange={(e) => set('taxPct', Number(e.target.value))} /></div>
          <div><label className="label">Total (auto)</label>
            <div className="input !flex items-center font-medium">{fmtMoney(total, form.currency)}</div></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Currency</label><input className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)} /></div>
          <div><label className="label">Due Date</label><input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
        </div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Invoice</button>
      </form>
    </Modal>
  );
}

interface Payment {
  id: string; amount: string; paidAt: string; method: string | null; reference: string | null;
  recordedBy: { fullName: string } | null;
}

function PaymentModal({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ amount: 0, method: '', reference: '' });
  const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid);

  const { data: detail } = useQuery({
    queryKey: ['invoice-detail', invoice.id],
    queryFn: () => api<{ payments: Payment[] }>(`/invoices/${invoice.id}`),
  });

  const record = useMutation({
    mutationFn: () => api(`/invoices/${invoice.id}/payments`, { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice-detail', invoice.id] });
      setForm({ amount: 0, method: '', reference: '' });
    },
  });

  return (
    <Modal title={`Payments — ${invoice.invoiceNumber}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          Total {fmtMoney(invoice.totalAmount, invoice.currency)} · Paid <span className="text-emerald-600">{fmtMoney(invoice.amountPaid, invoice.currency)}</span> · Balance <span className="text-red-500 font-medium">{fmtMoney(balance, invoice.currency)}</span>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {detail?.payments.length === 0 && <p className="text-sm text-gray-400">No payments recorded yet.</p>}
          {detail?.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm border-b border-gray-100 dark:border-gray-800 pb-1">
              <div>
                <div className="font-medium">{fmtMoney(p.amount, invoice.currency)}</div>
                <div className="text-xs text-gray-400">{p.method ?? 'Payment'}{p.reference ? ` · ${p.reference}` : ''} · {p.recordedBy?.fullName ?? '-'}</div>
              </div>
              <div className="text-gray-500">{fmtDate(p.paidAt)}</div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); record.mutate(); }} className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
          <div className="text-xs text-gray-500 uppercase font-semibold">Record Payment</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="number" step="0.01" placeholder="Amount" max={balance}
              value={form.amount || ''} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} required />
            <input className="input" placeholder="Method (bank transfer, cheque…)"
              value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} />
          </div>
          <input className="input" placeholder="Reference (optional)"
            value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
          <ErrorText error={record.error} />
          <button className="btn-primary w-full justify-center" disabled={record.isPending}>Add Payment</button>
        </form>
      </div>
    </Modal>
  );
}

interface AgingBucket { label: string; count: number; total: number }
interface AgingRow { invoiceNumber: string; customer: string; currency: string; balance: number; daysOverdue: number; bucket: string }

function AgingModal({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['invoices-aging'],
    queryFn: () => api<{ rows: AgingRow[]; buckets: AgingBucket[]; totalOutstanding: number }>('/invoices/aging'),
  });

  return (
    <Modal title="Invoice Aging Report" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-2">
          {data?.buckets.map((b) => (
            <div key={b.label} className="card p-3 text-center">
              <div className="text-xs text-gray-500 uppercase font-semibold">{b.label}</div>
              <div className="text-lg font-bold">{fmtMoney(b.total, 'MYR')}</div>
              <div className="text-xs text-gray-400">{b.count} invoice{b.count === 1 ? '' : 's'}</div>
            </div>
          ))}
        </div>
        <Table head={['Invoice #', 'Customer', 'Balance', 'Days Overdue', 'Bucket']} empty={data?.rows.length === 0}>
          {data?.rows.map((r) => (
            <tr key={r.invoiceNumber}>
              <td className="td font-medium text-primary">{r.invoiceNumber}</td>
              <td className="td">{r.customer}</td>
              <td className="td">{fmtMoney(r.balance, r.currency)}</td>
              <td className="td">{r.daysOverdue > 0 ? r.daysOverdue : '-'}</td>
              <td className="td"><StatusBadge status={r.bucket === 'Current' ? 'ACTIVE' : 'INACTIVE'} /> {r.bucket}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Modal>
  );
}
