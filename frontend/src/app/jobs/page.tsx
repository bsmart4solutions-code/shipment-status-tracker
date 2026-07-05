'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, MapPin, Plus, Receipt, Sparkles, Trash2, Upload } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Modal, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission, uploadFile } from '@/lib/api';
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
  const [docsFor, setDocsFor] = useState<JobRow | null>(null);

  const { data } = useQuery({
    queryKey: ['jobs', page, search, status],
    queryFn: () => api<{ items: JobRow[]; pageCount: number }>(
      `/jobs?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const qc = useQueryClient();
  const canWrite = hasPermission('jobs.write');
  const canInvoice = hasPermission('invoices.write');

  const genInvoice = useMutation({
    mutationFn: (jobId: string) => api<{ invoiceNumber: string }>(`/invoices/from-job/${jobId}`, { method: 'POST' }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      alert(`Draft invoice ${inv.invoiceNumber} created. Find it under Invoices.`);
    },
  });

  return (
    <Shell title="Jobs / Shipments" actions={canWrite ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Job</button> : undefined}>
      <ErrorText error={genInvoice.error} />
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
                <button className="text-primary hover:underline text-sm" onClick={() => setDocsFor(j)}>Docs</button>
                {canWrite && <button className="text-primary hover:underline text-sm" onClick={() => setEditing(j)}>Edit</button>}
                {canInvoice && Number(j.actualRevenue) > 0 && (
                  <button className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                    disabled={genInvoice.isPending}
                    onClick={() => { if (confirm(`Generate a draft invoice for ${j.jobNumber} (${fmtMoney(j.actualRevenue, j.currency)})?`)) genInvoice.mutate(j.id); }}>
                    <Receipt size={13} /> Invoice
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {editing && <JobModal job={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {tracking && <TrackingModal job={tracking} onClose={() => setTracking(null)} />}
      {docsFor && <DocumentsModal job={docsFor} onClose={() => setDocsFor(null)} />}
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

interface JobDocument {
  id: string; name: string; originalName: string | null; category: string | null;
  mimeType: string | null; sizeBytes: number | null; uploadedAt: string;
  extracted: ExtractionResult | null;
}
interface ExtractionResult {
  textLayerPresent: boolean; needsOcr: boolean; documentType: string; confidence: number;
  ocrUsed?: boolean;
  fields: {
    blNumber?: string; vessel?: string; voyage?: string; portOfLoading?: string;
    portOfDischarge?: string; placeOfDelivery?: string; eta?: string;
    invoiceNumber?: string; invoiceDate?: string; issueDate?: string;
  };
}

function DocumentsModal({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const qc = useQueryClient();
  const canWrite = hasPermission('jobs.write');
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('BL');
  const [extraction, setExtraction] = useState<{ docId: string; result: ExtractionResult } | null>(null);

  const { data: docs } = useQuery({
    queryKey: ['job-docs', job.id],
    queryFn: () => api<JobDocument[]>(`/jobs/${job.id}/documents`),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(`/jobs/${job.id}/documents/upload`, file, { category }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-docs', job.id] }),
  });
  const extract = useMutation({
    mutationFn: (docId: string) => api<ExtractionResult>(`/documents/${docId}/extract`, { method: 'POST' }),
    onSuccess: (result, docId) => { setExtraction({ docId, result }); qc.invalidateQueries({ queryKey: ['job-docs', job.id] }); },
  });
  const del = useMutation({
    mutationFn: (docId: string) => api(`/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-docs', job.id] }),
  });
  const applyToJob = useMutation({
    mutationFn: (f: ExtractionResult['fields']) => api(`/jobs/${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        origin: f.portOfLoading || undefined,
        destination: f.portOfDischarge || undefined,
        trackingNumber: f.blNumber || undefined,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jobs'] }); alert('Job updated with extracted origin / destination / B-L number.'); },
  });

  const fmtSize = (b: number | null) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  return (
    <Modal title={`Documents — ${job.jobNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        {canWrite && (
          <div className="flex items-center gap-2">
            <select className="input max-w-[130px]" value={category} onChange={(e) => setCategory(e.target.value)}>
              {['BL', 'Invoice', 'Permit', 'POD', 'Packing List', 'Other'].map((c) => <option key={c}>{c}</option>)}
            </select>
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <Upload size={15} /> {upload.isPending ? 'Uploading…' : 'Upload document'}
            </button>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <span className="text-xs text-gray-400">PDF / image / office · max 15 MB</span>
          </div>
        )}
        <ErrorText error={upload.error || extract.error || del.error || applyToJob.error} />

        <div className="space-y-2 max-h-56 overflow-y-auto">
          {docs?.length === 0 && <p className="text-sm text-gray-400">No documents uploaded yet.</p>}
          {docs?.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={15} className="text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.originalName || d.name}</div>
                  <div className="text-xs text-gray-400">{d.category} · {fmtSize(d.sizeBytes)} · {fmtDate(d.uploadedAt)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <a className="text-primary hover:underline text-sm" href={`/api/documents/${d.id}/download`} target="_blank" rel="noreferrer">Download</a>
                {canWrite && d.mimeType === 'application/pdf' && (
                  <button className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                    onClick={() => extract.mutate(d.id)} disabled={extract.isPending}>
                    <Sparkles size={13} /> {extract.isPending ? 'Extracting… (OCR can take ~15s)' : 'Extract'}
                  </button>
                )}
                {canWrite && (
                  <button className="text-red-500 hover:underline text-sm" onClick={() => { if (confirm('Delete this document?')) del.mutate(d.id); }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {extraction && (
          <div className="card p-3 space-y-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Sparkles size={14} className="text-primary" /> Extraction result
              <span className="text-xs font-normal text-gray-400">
                {extraction.result.documentType} · confidence {Math.round(extraction.result.confidence * 100)}%
              </span>
              {extraction.result.ocrUsed && (
                <span className="text-xs badge bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">OCR</span>
              )}
            </div>
            {extraction.result.ocrUsed && !extraction.result.needsOcr && (
              <p className="text-xs text-amber-600">Scanned document read via OCR — values may contain recognition errors, please double-check before applying.</p>
            )}
            {extraction.result.needsOcr ? (
              <p className="text-sm text-amber-600">
                {extraction.result.ocrUsed
                  ? 'OCR ran but could not read this scan — the image quality is too low. Manual entry needed.'
                  : 'No text layer found — this looks like a scan. It needs OCR or manual entry.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {Object.entries(extraction.result.fields).map(([k, v]) => (
                    <div key={k}><span className="text-gray-400">{k}:</span> <span className="font-medium">{v}</span></div>
                  ))}
                </div>
                {canWrite && (extraction.result.fields.portOfLoading || extraction.result.fields.portOfDischarge || extraction.result.fields.blNumber) && (
                  <button className="btn-primary text-sm" onClick={() => applyToJob.mutate(extraction.result.fields)} disabled={applyToJob.isPending}>
                    Apply origin / destination / B-L to this job
                  </button>
                )}
              </>
            )}
          </div>
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
