'use client';

/**
 * Printable quotation — replicates the company's standard quotation layout
 * (Solid Xpress format): letterhead, customer/meta blocks, RE line, shipment
 * details, SST-aware line-item table, totals, signature blocks and the 13
 * standard FMFF trading conditions. Use the Print button (or Ctrl+P) and
 * "Save as PDF" to produce the customer-facing document.
 */

import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { COMPANY, QUOTATION_TERMS } from '@/lib/company';

interface PrintQuote {
  id: string; quoteNumber: string; quoteDate: string; validityDate: string | null;
  status: string; currency: string; remark: string | null;
  subject: string | null; yourRef: string | null; attn: string | null;
  pol: string | null; pod: string | null; shipmentType: string | null;
  goods: string | null; shippingTerm: string | null; paymentTerm: string | null;
  subtotalSell: string; discountAmt: string; serviceChargePct: string; miscCharge: string;
  taxPct: string; taxAmt: string; sellingPrice: string;
  customer: { companyName: string; address: string | null; phone: string | null; email: string | null; pic: string | null; paymentTerm: string | null };
  salesPerson: { fullName: string } | null;
  items: {
    id: string; description: string | null; quantity: string; unit: string | null;
    fxRate: string; unitSell: string; totalSell: string; taxExempt: boolean;
    service: { name: string };
  }[];
}

const dmy = (d: string | null | undefined) => {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};
const n2 = (v: string | number) => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = (v: string | number) => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export default function QuotationPrintPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: q } = useQuery({ queryKey: ['quotation', params.id], queryFn: () => api<PrintQuote>(`/quotations/${params.id}`) });

  if (!q) return <div className="p-10 text-center text-gray-400">Loading…</div>;

  const taxPct = Number(q.taxPct);
  const lineTax = (it: PrintQuote['items'][number]) => (it.taxExempt ? 0 : Number(it.totalSell) * (taxPct / 100));
  const ccy = q.currency;
  // RE line: explicit subject wins; otherwise compose from POL/POD.
  let reLine = q.subject;
  if (!reLine) {
    reLine = q.pol || q.pod
      ? `QUOTATION FOR SHIPMENT${q.pol ? ` FROM ${q.pol}` : ''}${q.pod ? ` TO ${q.pod}` : ''}`
      : `QUOTATION ${q.quoteNumber}`;
  }

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      {/* Screen-only action bar */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-300 px-6 py-3 flex items-center gap-3">
        <button className="btn-ghost" onClick={() => router.push(`/quotations/${q.id}`)}><ArrowLeft size={15} /> Back</button>
        <span className="text-sm text-gray-500">{q.quoteNumber} — print preview</span>
        <button className="btn-primary ml-auto" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
      </div>

      {/* A4 sheet */}
      <div className="mx-auto max-w-[210mm] bg-white text-black shadow print:shadow-none px-10 py-8 my-6 print:my-0 text-[11px] leading-snug font-sans">

        {/* ── Letterhead ── */}
        <div className="flex justify-between items-start border-b-2 border-black pb-2">
          <div>
            <div className="text-[15px] font-bold">{COMPANY.name}</div>
            {COMPANY.addressLines.map((l) => <div key={l}>{l}</div>)}
            <div>Tel : {COMPANY.tel}</div>
            <div>Email : {COMPANY.email}</div>
            <div>Co. No : {COMPANY.coNo}&nbsp;&nbsp;&nbsp;SST ID : {COMPANY.sstId}</div>
          </div>
          <div className="text-[20px] font-bold tracking-widest mt-1">QUOTATION</div>
        </div>

        {/* ── Customer / meta ── */}
        <div className="grid grid-cols-[1.4fr_1fr] gap-6 mt-3">
          <table className="self-start"><tbody>
            <tr><td className="align-top pr-2 whitespace-nowrap">Customer</td><td className="align-top pr-1">:</td><td className="font-semibold">{q.customer.companyName}</td></tr>
            <tr><td className="align-top pr-2">Address</td><td className="align-top pr-1">:</td><td className="whitespace-pre-line">{q.customer.address ?? ''}</td></tr>
            <tr><td className="pr-2">Tel</td><td className="pr-1">:</td><td>{q.customer.phone ?? ''}</td></tr>
            <tr><td className="pr-2">Attn</td><td className="pr-1">:</td><td>{q.attn ?? q.customer.pic ?? ''}</td></tr>
            <tr><td className="pr-2">Email</td><td className="pr-1">:</td><td>{q.customer.email ?? ''}</td></tr>
          </tbody></table>
          <table className="self-start"><tbody>
            <tr><td className="pr-2 whitespace-nowrap">Quotation No</td><td className="pr-1">:</td><td className="font-semibold">{q.quoteNumber}</td></tr>
            <tr><td className="pr-2">Date</td><td className="pr-1">:</td><td>{dmy(q.quoteDate)}</td></tr>
            <tr><td className="pr-2">Your Ref No</td><td className="pr-1">:</td><td>{q.yourRef ?? ''}</td></tr>
            <tr><td className="pr-2">Terms</td><td className="pr-1">:</td><td>{q.paymentTerm ?? q.customer.paymentTerm ?? ''}</td></tr>
            <tr><td className="pr-2">Salesman</td><td className="pr-1">:</td><td>{q.salesPerson?.fullName ?? ''}</td></tr>
          </tbody></table>
        </div>

        {/* ── RE + intro + shipment block ── */}
        <div className="mt-3 font-bold">RE : {reLine}</div>
        <div className="mt-1">We thank you for your enquiry and pleased to furnish our quotation for your kind attention :</div>

        <div className="grid grid-cols-2 gap-x-8 mt-2 border border-black p-2">
          <div><span className="inline-block w-28">POL</span>: {q.pol ?? '-'}</div>
          <div><span className="inline-block w-28">POD</span>: {q.pod ?? '-'}</div>
          <div><span className="inline-block w-28">Shipment Type</span>: {q.shipmentType ?? '-'}</div>
          {q.goods && <div><span className="inline-block w-28">Goods</span>: {q.goods}</div>}
          {q.shippingTerm && <div><span className="inline-block w-28">Shipping Term</span>: {q.shippingTerm}</div>}
          <div><span className="inline-block w-28">Payment Term</span>: {q.paymentTerm ?? q.customer.paymentTerm ?? '-'}</div>
          <div><span className="inline-block w-28">Validity Date</span>: <span className="font-semibold">{dmy(q.validityDate)}</span></div>
        </div>

        {/* ── Line items ── */}
        <table className="w-full mt-3 border-collapse">
          <thead>
            <tr className="border-y-2 border-black text-left">
              <th className="py-1 pr-1 font-semibold w-5">#</th>
              <th className="py-1 pr-2 font-semibold">Description</th>
              <th className="py-1 px-1 font-semibold text-right">Unit Price</th>
              <th className="py-1 px-1 font-semibold">UOM</th>
              <th className="py-1 px-1 font-semibold text-right">Qty</th>
              <th className="py-1 px-1 font-semibold text-right">Ex. Rate</th>
              <th className="py-1 px-1 font-semibold text-right">Total Excl.<br />SST ({ccy})</th>
              <th className="py-1 px-1 font-semibold text-center">Tax<br />Code</th>
              <th className="py-1 px-1 font-semibold text-right">Tax<br />Rate</th>
              <th className="py-1 px-1 font-semibold text-right">Tax<br />Amount</th>
              <th className="py-1 pl-1 font-semibold text-right">Total Incl.<br />SST ({ccy})</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((it, i) => {
              const tax = lineTax(it);
              const name = (it.description || it.service.name).split('\n');
              return (
                <tr key={it.id} className="align-top">
                  <td className="py-0.5 pr-1">{i + 1}</td>
                  <td className="py-0.5 pr-2">
                    <div className="font-medium uppercase">{name[0]}</div>
                    {name.slice(1).map((l, x) => <div key={x} className="text-[10px]">{l}</div>)}
                  </td>
                  <td className="py-0.5 px-1 text-right whitespace-nowrap">{ccy} {n2(it.unitSell)}</td>
                  <td className="py-0.5 px-1 uppercase">{it.unit ?? ''}</td>
                  <td className="py-0.5 px-1 text-right">{n4(it.quantity)}</td>
                  <td className="py-0.5 px-1 text-right">{n4(it.fxRate)}</td>
                  <td className="py-0.5 px-1 text-right">{n2(it.totalSell)}</td>
                  <td className="py-0.5 px-1 text-center">{it.taxExempt ? 'SVE' : 'SV'}</td>
                  <td className="py-0.5 px-1 text-right">{it.taxExempt ? '0%' : `${Number(taxPct)}%`}</td>
                  <td className="py-0.5 px-1 text-right">{n2(tax)}</td>
                  <td className="py-0.5 pl-1 text-right">{n2(Number(it.totalSell) + tax)}</td>
                </tr>
              );
            })}
            {Number(q.discountAmt) > 0 && (
              <tr><td /><td className="py-0.5 pr-2 font-medium">DISCOUNT</td><td colSpan={4} /><td className="py-0.5 px-1 text-right">-{n2(q.discountAmt)}</td><td colSpan={4} /></tr>
            )}
            {Number(q.miscCharge) > 0 && (
              <tr><td /><td className="py-0.5 pr-2 font-medium">MISC CHARGES</td><td colSpan={4} /><td className="py-0.5 px-1 text-right">{n2(q.miscCharge)}</td><td colSpan={4} /></tr>
            )}
          </tbody>
        </table>

        {/* ── Totals ── */}
        <div className="flex justify-end mt-2 border-t-2 border-black pt-2">
          <table><tbody>
            <tr><td className="pr-4">Total (Excluding Tax)</td><td className="pr-1">:</td><td className="pr-2">{ccy}</td><td className="text-right font-semibold w-24">{n2(Number(q.sellingPrice) - Number(q.taxAmt))}</td></tr>
            <tr><td className="pr-4">Total Service Tax</td><td className="pr-1">:</td><td className="pr-2">{ccy}</td><td className="text-right font-semibold">{n2(q.taxAmt)}</td></tr>
            <tr className="text-[12px]"><td className="pr-4 font-bold">Total (Inclusive of Tax)</td><td className="pr-1">:</td><td className="pr-2 font-bold">{ccy}</td><td className="text-right font-bold border-t border-black">{n2(q.sellingPrice)}</td></tr>
          </tbody></table>
        </div>

        {/* ── Remark + closing ── */}
        <div className="mt-3">
          <div className="font-semibold">REMARK :</div>
          {q.remark && <div className="whitespace-pre-line">{q.remark}</div>}
          <div className="mt-1">We hope the above rate is workable or meet your requirement. We look forward for your valuable support.</div>
          <div>Please do not hesitate to contact us.</div>
        </div>

        {/* ── Signatures ── */}
        <div className="grid grid-cols-2 gap-10 mt-6">
          <div>
            <div>Yours sincerely,</div>
            <div className="font-semibold mt-1">{COMPANY.name}</div>
            <div className="mt-10 border-t border-dotted border-black w-56 pt-0.5">
              {q.salesPerson?.fullName?.toUpperCase() ?? ''}<br />(H/P :)
            </div>
          </div>
          <div>
            <div>I / We hereby confirm the acceptance of the above rate</div>
            <div className="mt-14 border-t border-dotted border-black w-56 pt-0.5">Authorized Co. Chop &amp; Sign</div>
          </div>
        </div>

        {/* ── Terms & conditions ── */}
        <div className="mt-5 text-[9px] leading-tight">
          <div className="font-semibold text-[10px]">Terms and conditions :</div>
          <ol className="list-decimal ml-4">
            {QUOTATION_TERMS.map((t) => <li key={t}>{t}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
