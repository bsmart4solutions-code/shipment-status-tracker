'use client';

/**
 * Bookings (Sprint 06, P0-4) — the step between winning a quotation and
 * operating a shipment file. Confirming a booking is what opens the Job, so
 * that action is deliberately explicit and confirmed by the user.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Plus } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Modal, Pagination, SearchableSelect, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate } from '@/lib/utils';

const BOOKING_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'];

interface BookingRow {
  id: string; bookingNumber: string; status: string; carrier: string | null; carrierBookingNo: string | null;
  bookingDate: string; siCutoff: string | null; vgmCutoff: string | null; cyCutoff: string | null;
  etd: string | null; eta: string | null; origin: string | null; destination: string | null;
  currency: string; notes: string | null; customerId: string; vendorId: string | null; quotationId: string | null;
  customer: { companyName: string; code: string };
  vendor: { name: string } | null;
  quotation: { quoteNumber: string } | null;
  jobs: { id: string; jobNumber: string; milestone: string | null }[];
}

/** A cut-off already past is the thing this whole screen exists to prevent. */
function Cutoff({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-400">-</span>;
  const overdue = new Date(date).getTime() < Date.now();
  return <span className={overdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}>{fmtDate(date)}</span>;
}

export default function BookingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<BookingRow | 'new' | null>(null);

  const { data } = useQuery({
    queryKey: ['bookings', page, search, status],
    queryFn: () => api<{ items: BookingRow[]; pageCount: number }>(
      `/bookings?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('bookings.write');

  const confirm_ = useMutation({
    mutationFn: (id: string) => api<{ jobNumber: string }>(`/bookings/${id}/confirm`, { method: 'POST' }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      alert(`Booking confirmed — shipment file ${job.jobNumber} is open. Find it under Jobs / Shipments.`);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });

  return (
    <Shell title="Bookings" actions={
      canWrite ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Booking</button> : null
    }>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder="Search booking #, carrier, customer…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[170px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <ErrorText error={confirm_.error || cancel.error} />

      <Table head={['Booking #', 'Customer', 'Quote', 'Carrier', 'Route', 'SI Cut-off', 'VGM Cut-off', 'ETD / ETA', 'Shipment', 'Status', '']}
        empty={data?.items.length === 0}>
        {data?.items.map((b) => (
          <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="td font-medium text-primary">{b.bookingNumber}</td>
            <td className="td">{b.customer.companyName}</td>
            <td className="td text-gray-500">{b.quotation?.quoteNumber ?? '-'}</td>
            <td className="td text-gray-500">
              {b.vendor?.name ?? b.carrier ?? '-'}
              {b.carrierBookingNo && <div className="text-xs text-gray-400">{b.carrierBookingNo}</div>}
            </td>
            <td className="td text-gray-500">{b.origin || '?'} → {b.destination || '?'}</td>
            <td className="td text-gray-500"><Cutoff date={b.siCutoff} /></td>
            <td className="td text-gray-500"><Cutoff date={b.vgmCutoff} /></td>
            <td className="td text-gray-500">{fmtDate(b.etd)} / {fmtDate(b.eta)}</td>
            <td className="td">
              {b.jobs.length > 0 ? (
                <button className="text-primary hover:underline text-sm" onClick={() => router.push('/jobs')}>
                  {b.jobs[0].jobNumber}
                </button>
              ) : <span className="text-gray-400">-</span>}
            </td>
            <td className="td"><StatusBadge status={b.status} /></td>
            <td className="td">
              <div className="flex gap-2 justify-end">
                {canWrite && b.status === 'DRAFT' && (
                  <button className="text-primary hover:underline text-sm" onClick={() => setEditing(b)}>Edit</button>
                )}
                {canWrite && b.status === 'DRAFT' && (
                  <button className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                    disabled={confirm_.isPending}
                    onClick={() => {
                      if (confirm(`Confirm ${b.bookingNumber} with the carrier? This opens the shipment file and cannot be undone.`)) {
                        confirm_.mutate(b.id);
                      }
                    }}>
                    <Anchor size={13} /> Confirm
                  </button>
                )}
                {canWrite && b.status !== 'CANCELLED' && (
                  <button className="text-red-500 hover:underline text-sm"
                    onClick={() => { if (confirm(`Cancel ${b.bookingNumber}?`)) cancel.mutate(b.id); }}>
                    Cancel
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {editing && <BookingModal booking={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Shell>
  );
}

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];

function BookingModal({ booking, onClose }: { booking: BookingRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    customerId: booking?.customerId ?? '',
    vendorId: booking?.vendorId ?? '',
    carrier: booking?.carrier ?? '',
    carrierBookingNo: booking?.carrierBookingNo ?? '',
    bookingDate: booking?.bookingDate?.slice(0, 10) ?? '',
    siCutoff: booking?.siCutoff?.slice(0, 10) ?? '',
    vgmCutoff: booking?.vgmCutoff?.slice(0, 10) ?? '',
    cyCutoff: booking?.cyCutoff?.slice(0, 10) ?? '',
    etd: booking?.etd?.slice(0, 10) ?? '',
    eta: booking?.eta?.slice(0, 10) ?? '',
    origin: booking?.origin ?? '',
    destination: booking?.destination ?? '',
    currency: booking?.currency ?? 'MYR',
    notes: booking?.notes ?? '',
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-all'],
    queryFn: () => api<{ items: { id: string; companyName: string }[] }>('/customers?pageSize=200'),
  });
  const { data: vendors } = useQuery({
    queryKey: ['vendors-all'],
    queryFn: () => api<{ items: { id: string; name: string }[] }>('/vendors?pageSize=200'),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        vendorId: form.vendorId || undefined,
        carrier: form.carrier || undefined,
        carrierBookingNo: form.carrierBookingNo || undefined,
        bookingDate: form.bookingDate || undefined,
        siCutoff: form.siCutoff || undefined,
        vgmCutoff: form.vgmCutoff || undefined,
        cyCutoff: form.cyCutoff || undefined,
        etd: form.etd || undefined,
        eta: form.eta || undefined,
        origin: form.origin || undefined,
        destination: form.destination || undefined,
        notes: form.notes || undefined,
      };
      return booking
        ? api(`/bookings/${booking.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/bookings', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); onClose(); },
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal title={booking ? `Edit ${booking.bookingNumber}` : 'New Booking'} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Customer <span className="text-red-500">*</span></label>
            <SearchableSelect value={form.customerId} onChange={(v) => set('customerId', v)} placeholder="Search customer…"
              options={(customers?.items ?? []).map((c) => ({ value: c.id, label: c.companyName }))} />
          </div>
          <div>
            <label className="label">Carrier (vendor)</label>
            <SearchableSelect value={form.vendorId} onChange={(v) => set('vendorId', v)} placeholder="Search vendor…"
              options={(vendors?.items ?? []).map((v) => ({ value: v.id, label: v.name }))} />
          </div>
          <div>
            <label className="label">Carrier (free text, if not a vendor)</label>
            <input className="input" value={form.carrier} onChange={(e) => set('carrier', e.target.value)} />
          </div>
          <div>
            <label className="label">Carrier Booking No.</label>
            <input className="input" placeholder="the carrier's own reference" value={form.carrierBookingNo} onChange={(e) => set('carrierBookingNo', e.target.value)} />
          </div>
          <div><label className="label">Origin (POL)</label><input className="input" value={form.origin} onChange={(e) => set('origin', e.target.value)} /></div>
          <div><label className="label">Destination (POD)</label><input className="input" value={form.destination} onChange={(e) => set('destination', e.target.value)} /></div>
        </div>

        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-1">Cut-offs & schedule</div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">SI Cut-off</label><input className="input" type="date" value={form.siCutoff} onChange={(e) => set('siCutoff', e.target.value)} /></div>
          <div><label className="label">VGM Cut-off</label><input className="input" type="date" value={form.vgmCutoff} onChange={(e) => set('vgmCutoff', e.target.value)} /></div>
          <div><label className="label">CY Cut-off</label><input className="input" type="date" value={form.cyCutoff} onChange={(e) => set('cyCutoff', e.target.value)} /></div>
          <div><label className="label">Booking Date</label><input className="input" type="date" value={form.bookingDate} onChange={(e) => set('bookingDate', e.target.value)} /></div>
          <div><label className="label">ETD</label><input className="input" type="date" value={form.etd} onChange={(e) => set('etd', e.target.value)} /></div>
          <div><label className="label">ETA</label><input className="input" type="date" value={form.eta} onChange={(e) => set('eta', e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Currency</label>
            <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select></div>
        </div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>

        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={!form.customerId || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save Booking'}
        </button>
      </form>
    </Modal>
  );
}
