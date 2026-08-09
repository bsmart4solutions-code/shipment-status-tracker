'use client';

/**
 * Printable Booking Confirmation.
 *
 * This one goes OUT to the carrier, so it is laid out around what a carrier
 * checks: their own booking reference first, then the cut-offs. Cut-offs get
 * their own boxed block rather than sitting in a list of dates — missing one
 * means the container does not sail, and a document that buries that among
 * eight other fields is how it gets missed.
 *
 * Same house letterhead as the invoice and note documents.
 */

import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useCompany } from '@/lib/company';

interface PrintBooking {
  id: string; bookingNumber: string; status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  bookingDate: string; carrier: string | null; carrierBookingNo: string | null;
  siCutoff: string | null; vgmCutoff: string | null; cyCutoff: string | null;
  etd: string | null; eta: string | null;
  origin: string | null; destination: string | null;
  currency: string; notes: string | null;
  customer: { companyName: string; address: string | null; phone: string | null; email: string | null; pic: string | null };
  vendor: { name: string; contactPerson: string | null; phone: string | null; email: string | null } | null;
  quotation: { quoteNumber: string } | null;
  jobs: { jobNumber: string }[];
  createdBy: { fullName: string } | null;
}

const dmy = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};
/** Cut-offs are time-of-day critical — a date alone is not actionable. */
const dmyhm = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${dmy(d)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

export default function BookingPrint({ params }: { params: { id: string } }) {
  const router = useRouter();
  const COMPANY = useCompany();
  const { data: b, isLoading, error } = useQuery({
    queryKey: ['booking-print', params.id],
    queryFn: () => api<PrintBooking>(`/bookings/${params.id}`),
  });

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading…</div>;
  if (error || !b) return <div className="p-10 text-center text-red-500 text-sm">Could not load this booking.</div>;

  const CUTOFFS = [
    { label: 'SI CUT-OFF', value: b.siCutoff },
    { label: 'VGM CUT-OFF', value: b.vgmCutoff },
    { label: 'CY CUT-OFF', value: b.cyCutoff },
  ];

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-300 px-6 py-3 flex items-center gap-3">
        <button className="btn-ghost" onClick={() => router.push('/bookings')}><ArrowLeft size={15} /> Back</button>
        <span className="text-sm text-gray-500">{b.bookingNumber} — print preview</span>
        <button className="btn-primary ml-auto" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
      </div>

      <div className="mx-auto max-w-[210mm] bg-white text-black shadow print:shadow-none px-10 py-8 my-6 print:my-0 text-[10.5px] leading-snug font-sans">

        {/* ── Letterhead ── */}
        <div className="flex justify-between items-start border-b-2 border-black pb-2">
          <div className="flex items-start gap-3">
            {COMPANY.logoDataUrl && <img src={COMPANY.logoDataUrl} alt="" className="h-14 w-auto object-contain" />}
            <div>
              <div className="text-[15px] font-bold">{COMPANY.name}</div>
              {COMPANY.addressLines.map((l) => <div key={l}>{l}</div>)}
              <div>Tel : {COMPANY.tel}{COMPANY.fax ? `   Fax : ${COMPANY.fax}` : ''}</div>
              <div>Email : {COMPANY.email}</div>
              {COMPANY.website && <div>Web : {COMPANY.website}</div>}
              <div>Co. No : {COMPANY.coNo}&nbsp;&nbsp;&nbsp;SST ID : {COMPANY.sstId}</div>
            </div>
          </div>
          <div className="text-right mt-1">
            <div className="text-[18px] font-bold tracking-widest">BOOKING</div>
            <div className="text-[18px] font-bold tracking-widest">CONFIRMATION</div>
            {/* A draft must never be mistaken for a confirmed booking by the
                carrier, so the status is stamped, not tucked into a field. */}
            {b.status !== 'CONFIRMED' && (
              <div className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-[11px] font-bold tracking-wider">
                {b.status}
              </div>
            )}
          </div>
        </div>

        {/* ── Parties + references ── */}
        <div className="grid grid-cols-[1.5fr_1fr] gap-6 mt-3">
          <div>
            <div>SHIPPER / CUSTOMER :</div>
            <div className="font-semibold">{b.customer.companyName}</div>
            {b.customer.address && <div className="whitespace-pre-line">{b.customer.address}</div>}
            {b.customer.pic && <div>ATTN : {b.customer.pic}</div>}
            {b.customer.phone && <div>TEL : {b.customer.phone}</div>}

            {b.vendor && (
              <div className="mt-2">
                <div>CARRIER / AGENT :</div>
                <div className="font-semibold">{b.vendor.name}</div>
                {b.vendor.contactPerson && <div>ATTN : {b.vendor.contactPerson}</div>}
                {b.vendor.phone && <div>TEL : {b.vendor.phone}</div>}
              </div>
            )}
          </div>
          <table className="self-start"><tbody>
            <tr><td className="pr-2 whitespace-nowrap">BOOKING NO</td><td className="pr-1">:</td><td className="font-semibold">{b.bookingNumber}</td></tr>
            <tr><td className="pr-2">DATE</td><td className="pr-1">:</td><td>{dmy(b.bookingDate)}</td></tr>
            {/* The carrier's own reference — the first thing they look for. */}
            {b.carrierBookingNo && (
              <tr><td className="pr-2">CARRIER BKG NO</td><td className="pr-1">:</td><td className="font-semibold">{b.carrierBookingNo}</td></tr>
            )}
            {b.carrier && <tr><td className="pr-2">CARRIER</td><td className="pr-1">:</td><td>{b.carrier}</td></tr>}
            {b.quotation && <tr><td className="pr-2">OUR QUOTE</td><td className="pr-1">:</td><td>{b.quotation.quoteNumber}</td></tr>}
            {b.jobs.map((j) => (
              <tr key={j.jobNumber}><td className="pr-2">JOB NO</td><td className="pr-1">:</td><td>{j.jobNumber}</td></tr>
            ))}
          </tbody></table>
        </div>

        {/* ── Routing ── */}
        <table className="w-full mt-4 border-collapse">
          <thead>
            <tr className="border-y-2 border-black text-left">
              <th className="py-1 pr-2 font-semibold">ORIGIN</th>
              <th className="py-1 px-1 font-semibold">DESTINATION</th>
              <th className="py-1 px-1 font-semibold">ETD</th>
              <th className="py-1 pl-1 font-semibold">ETA</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-400">
              <td className="py-1 pr-2 font-medium uppercase">{b.origin ?? '—'}</td>
              <td className="py-1 px-1 font-medium uppercase">{b.destination ?? '—'}</td>
              <td className="py-1 px-1">{dmy(b.etd)}</td>
              <td className="py-1 pl-1">{dmy(b.eta)}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Cut-offs: the operational heart of the document ── */}
        <div className="mt-4 border-2 border-black">
          <div className="bg-black text-white px-2 py-1 text-[11px] font-bold tracking-wider">CUT-OFF TIMES</div>
          <div className="grid grid-cols-3">
            {CUTOFFS.map((c, i) => (
              <div key={c.label} className={`px-3 py-2 ${i < 2 ? 'border-r border-black' : ''}`}>
                <div className="text-[9px] tracking-wider text-gray-700">{c.label}</div>
                <div className="text-[12px] font-bold">{dmyhm(c.value)}</div>
              </div>
            ))}
          </div>
        </div>

        {b.notes && (
          <div className="mt-3 whitespace-pre-line"><span className="font-semibold">REMARKS :</span> {b.notes}</div>
        )}

        {/* ── Signatures ── */}
        <div className="grid grid-cols-2 gap-10 mt-10">
          <div>
            <div className="border-t border-black pt-1">Issued by{b.createdBy ? ` — ${b.createdBy.fullName}` : ''}</div>
            <div className="text-[9px] text-gray-600">{COMPANY.name}</div>
          </div>
          <div>
            <div className="border-t border-black pt-1">Confirmed by (Carrier)</div>
            <div className="text-[9px] text-gray-600">Name / Signature / Date</div>
          </div>
        </div>

        <div className="mt-6 text-[9px] leading-tight border-t border-gray-400 pt-2">
          Please confirm the above booking and advise immediately if any cut-off time or vessel schedule changes.
        </div>
      </div>
    </div>
  );
}
