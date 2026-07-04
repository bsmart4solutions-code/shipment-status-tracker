'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Modal, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

const JOB_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

interface JobRow {
  id: string; jobNumber: string; status: string; origin: string | null; destination: string | null;
  etd: string | null; eta: string | null; trackingNumber: string | null; currency: string;
  actualCost: string; actualRevenue: string; profit: string;
  shipmentDate: string | null; notes: string | null; customerId: string; vendorId: string | null;
  customer: { companyName: string }; vendor: { name: string } | null;
  quotation: { quoteNumber: string } | null;
}

export default function JobsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<JobRow | 'new' | null>(null);
  const [tracking, setTracking] = useState<JobRow | null>(null);

  const { data } = useQuery({
    queryKey: ['jobs', page, search, status],
    queryFn: () => api<{ items: JobRow[]; pageCount: number }>(
      `/jobs?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('jobs.write');

  return (
    <Shell title="Jobs / Shipments" actions={canWrite ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Job</button> : undefined}>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder="Search job #, tracking #, customer…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[170px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <Table head={['Job #', 'Customer', 'Quote', 'Route', 'Vendor', 'ETD / ETA', 'Tracking', 'Revenue', 'Cost', 'Profit', 'Status', '']} empty={data?.items.length === 0}>
        {data?.items.map((j) => (
          <tr key={j.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="td font-medium text-primary">{j.jobNumber}</td>
            <td className="td">{j.customer.companyName}</td>
            <td className="td text-gray-500">{j.quotation?.quoteNumber ?? '-'}</td>
            <td className="td text-gray-500">{j.origin || '?'} → {j.destination || '?'}</td>
            <td className="td text-gray-500">{j.vendor?.name ?? '-'}</td>
            <td className="td text-gray-500">{fmtDate(j.etd)} / {fmtDate(j.eta)}</td>
            <td className="td text-gray-500">{j.trackingNumber || '-'}</td>
            <td className="td">{fmtMoney(j.actualRevenue, j.currency)}</td>
            <td className="td">{fmtMoney(j.actualCost, j.currency)}</td>
            <td className={`td font-medium ${Number(j.profit) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtMoney(j.profit, j.currency)}</td>
            <td className="td"><StatusBadge status={j.status} /></td>
            <td className="td">
              <div className="flex gap-2">
                <button className="text-primary hover:underline text-sm" onClick={() => setTracking(j)}>Track</button>
                {canWrite && <button className="text-primary hover:underline text-sm" onClick={() => setEditing(j)}>Edit</button>}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {editing && <JobModal job={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {tracking && <TrackingModal job={tracking} onClose={() => setTracking(null)} />}
    </Shell>
  );
}

interface TrackingEvent {
  id: string; status: string; location: string | null; description: string | null;
  occurredAt: string; source: 'SYSTEM' | 'MANUAL'; createdBy: { fullName: string } | null;
}

function TrackingModal({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const qc = useQueryClient();
  const canWrite = hasPermission('jobs.write');
  const [form, setForm] = useState({ status: job.status, location: '', description: '' });

  const { data: events } = useQuery({
    queryKey: ['job-tracking', job.id],
    queryFn: () => api<TrackingEvent[]>(`/jobs/${job.id}/tracking`),
  });

  const add = useMutation({
    mutationFn: () => api(`/jobs/${job.id}/tracking`, { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-tracking', job.id] });
      setForm((f) => ({ ...f, location: '', description: '' }));
    },
  });

  return (
    <Modal title={`Tracking — ${job.jobNumber}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-gray-500">{job.origin || '?'} → {job.destination || '?'} · <StatusBadge status={job.status} /></div>

        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {events?.length === 0 && <p className="text-sm text-gray-400">No tracking events yet.</p>}
          {events?.map((e, i) => (
            <div key={e.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${e.source === 'SYSTEM' ? 'bg-gray-400' : 'bg-primary'}`} />
                {i < events.length - 1 && <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 my-1" />}
              </div>
              <div className="pb-3">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {e.location && <MapPin size={12} className="text-gray-400" />}
                  {e.status}{e.location && <span className="text-gray-500 font-normal">— {e.location}</span>}
                </div>
                {e.description && <div className="text-sm text-gray-500">{e.description}</div>}
                <div className="text-xs text-gray-400 mt-0.5">
                  {fmtDate(e.occurredAt)} · {e.source === 'SYSTEM' ? 'Auto' : e.createdBy?.fullName ?? 'Manual'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {canWrite && (
          <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
            <div className="text-xs text-gray-500 uppercase font-semibold">Add Milestone</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Status / milestone (e.g. Departed origin port)"
                value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} required />
              <input className="input" placeholder="Location (optional)"
                value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <textarea className="input" rows={2} placeholder="Description (optional)"
              value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            <ErrorText error={add.error} />
            <button className="btn-primary w-full justify-center" disabled={add.isPending}>Add Event</button>
          </form>
        )}
      </div>
    </Modal>
  );
}

function JobModal({ job, onClose }: { job: JobRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    customerId: job?.customerId ?? '',
    vendorId: job?.vendorId ?? '',
    origin: job?.origin ?? '',
    destination: job?.destination ?? '',
    shipmentDate: job?.shipmentDate?.slice(0, 10) ?? '',
    etd: job?.etd?.slice(0, 10) ?? '',
    eta: job?.eta?.slice(0, 10) ?? '',
    trackingNumber: job?.trackingNumber ?? '',
    status: job?.status ?? 'OPEN',
    actualCost: job ? Number(job.actualCost) : 0,
    actualRevenue: job ? Number(job.actualRevenue) : 0,
    currency: job?.currency ?? 'MYR',
    notes: job?.notes ?? '',
  });

  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api<{ items: { id: string; companyName: string }[] }>('/customers?pageSize=200') });
  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: () => api<{ items: { id: string; name: string }[] }>('/vendors?pageSize=200') });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        vendorId: form.vendorId || undefined,
        shipmentDate: form.shipmentDate || undefined,
        etd: form.etd || undefined,
        eta: form.eta || undefined,
      };
      return job
        ? api(`/jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/jobs', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); onClose(); },
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const profit = form.actualRevenue - form.actualCost;

  return (
    <Modal title={job ? `Edit ${job.jobNumber}` : 'New Job'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Customer</label>
            <select className="input" value={form.customerId} onChange={(e) => set('customerId', e.target.value)} required>
              <option value="">— select —</option>
              {customers?.items.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select></div>
          <div><label className="label">Assigned Vendor</label>
            <select className="input" value={form.vendorId} onChange={(e) => set('vendorId', e.target.value)}>
              <option value="">— none —</option>
              {vendors?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select></div>
          <div><label className="label">Origin</label><input className="input" value={form.origin} onChange={(e) => set('origin', e.target.value)} /></div>
          <div><label className="label">Destination</label><input className="input" value={form.destination} onChange={(e) => set('destination', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Shipment Date</label><input className="input" type="date" value={form.shipmentDate} onChange={(e) => set('shipmentDate', e.target.value)} /></div>
          <div><label className="label">ETD</label><input className="input" type="date" value={form.etd} onChange={(e) => set('etd', e.target.value)} /></div>
          <div><label className="label">ETA</label><input className="input" type="date" value={form.eta} onChange={(e) => set('eta', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Tracking Number</label><input className="input" value={form.trackingNumber} onChange={(e) => set('trackingNumber', e.target.value)} /></div>
          <div><label className="label">Status</label>
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>{JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Actual Cost</label><input className="input" type="number" step="0.01" value={form.actualCost} onChange={(e) => set('actualCost', Number(e.target.value))} /></div>
          <div><label className="label">Actual Revenue</label><input className="input" type="number" step="0.01" value={form.actualRevenue} onChange={(e) => set('actualRevenue', Number(e.target.value))} /></div>
          <div><label className="label">Profit (auto)</label>
            <div className={`input !flex items-center ${profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtMoney(profit, form.currency)}</div></div>
        </div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Job</button>
      </form>
    </Modal>
  );
}
