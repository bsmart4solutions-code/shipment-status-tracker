'use client';

/**
 * Printable Credit / Debit Note — same house layout as the tax invoice
 * (letterhead, bill-to, SST-aware line table, totals, amount-in-words, bank
 * block) with the document title swapped and an "Against Invoice" reference.
 */

import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useCompany, INVOICE_FOOTER } from '@/lib/company';
import { amountInWords } from '@/lib/utils';

interface PrintNote {
  id: string; noteNumber: string; type: 'CREDIT' | 'DEBIT'; status: string; issueDate: string;
  currency: string; subtotal: string; taxPct: string; taxAmt: string; totalAmount: string;
  reason: string | null; notes: string | null;
  customer: { companyName: string; address: string | null; phone: string | null; email: string | null };
  invoice: { invoiceNumber: string } | null;
  items: {
    id: string; description: string; unitPrice: string; unit: string | null; quantity: string;
    lineCurrency: string; fxRate: string; amount: string; taxExempt: boolean; accNo: string | null;
  }[];
}

const dmy = (d: string | null | undefined) => {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};
const n2 = (v: string | number) => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: string | number) => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const n4 = (v: string | number) => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function NotePrintPage({ id, backPath }: { id: string; backPath: string }) {
  const router = useRouter();
  const COMPANY = useCompany();
  const BANK_INFO = COMPANY.bank;
  const { data: note, isLoading, error } = useQuery({ queryKey: ['note-print', id], queryFn: () => api<PrintNote>(`/credit-debit-notes/${id}`) });

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading…</div>;
  if (error || !note) return <div className="p-10 text-center text-red-500 text-sm">Could not load this note.</div>;

  const title = note.type === 'CREDIT' ? 'CREDIT NOTE' : 'DEBIT NOTE';
  const taxPct = Number(note.taxPct);
  const ccy = note.currency;
  const lineTax = (it: PrintNote['items'][number]) => (it.taxExempt ? 0 : Number(it.amount) * (taxPct / 100));
  const exemptTotal = note.items.filter((i) => i.taxExempt).reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-300 px-6 py-3 flex items-center gap-3">
        <button className="btn-ghost" onClick={() => router.push(backPath)}><ArrowLeft size={15} /> Back</button>
        <span className="text-sm text-gray-500">{note.noteNumber} — print preview</span>
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
          <div className="text-[20px] font-bold tracking-widest mt-1">{title}</div>
        </div>

        {/* ── Bill-to + meta ── */}
        <div className="grid grid-cols-[1.5fr_1fr] gap-6 mt-3">
          <div>
            <div>TO :</div>
            <div className="font-semibold">{note.customer.companyName}</div>
            {note.customer.address && <div className="whitespace-pre-line">{note.customer.address}</div>}
            {note.customer.phone && <div>TEL : {note.customer.phone}</div>}
          </div>
          <table className="self-start"><tbody>
            <tr><td className="pr-2 whitespace-nowrap">DATE</td><td className="pr-1">:</td><td>{dmy(note.issueDate)}</td></tr>
            <tr><td className="pr-2">{note.type === 'CREDIT' ? 'CN NO' : 'DN NO'}</td><td className="pr-1">:</td><td className="font-semibold">{note.noteNumber}</td></tr>
            {note.invoice && <tr><td className="pr-2">AGAINST INVOICE</td><td className="pr-1">:</td><td className="font-semibold">{note.invoice.invoiceNumber}</td></tr>}
          </tbody></table>
        </div>

        {note.reason && (
          <div className="mt-2"><span className="font-semibold">REASON :</span> {note.reason}</div>
        )}

        {/* ── Line items ── */}
        <table className="w-full mt-3 border-collapse">
          <thead>
            <tr className="border-y-2 border-black text-left align-bottom">
              <th className="py-1 pr-2 font-semibold">Description</th>
              <th className="py-1 px-1 font-semibold text-right">Unit Price</th>
              <th className="py-1 px-1 font-semibold">UOM</th>
              <th className="py-1 px-1 font-semibold text-right">Qty</th>
              <th className="py-1 px-1 font-semibold text-right">Ex.Rate</th>
              <th className="py-1 px-1 font-semibold text-right">Amount<br />(Excl Tax)</th>
              <th className="py-1 px-1 font-semibold text-center">Tax</th>
              <th className="py-1 px-1 font-semibold text-right">Tax Amt</th>
              <th className="py-1 px-1 font-semibold text-right">Amount<br />(Incl Tax)</th>
              <th className="py-1 pl-1 font-semibold text-right">Acc No</th>
            </tr>
          </thead>
          <tbody>
            {note.items.map((it) => {
              const tax = lineTax(it);
              return (
                <tr key={it.id} className="align-top">
                  <td className="py-0.5 pr-2 font-medium uppercase">{it.description}</td>
                  <td className="py-0.5 px-1 text-right whitespace-nowrap">{it.lineCurrency} {n3(it.unitPrice)}</td>
                  <td className="py-0.5 px-1 uppercase">{it.unit ?? ''}</td>
                  <td className="py-0.5 px-1 text-right">{n4(it.quantity)}</td>
                  <td className="py-0.5 px-1 text-right">{n4(it.fxRate)}</td>
                  <td className="py-0.5 px-1 text-right">{n2(it.amount)}</td>
                  <td className="py-0.5 px-1 text-center">{it.taxExempt ? 'SVE' : 'SV'}</td>
                  <td className="py-0.5 px-1 text-right">{n2(tax)}</td>
                  <td className="py-0.5 px-1 text-right">{n2(Number(it.amount) + tax)}</td>
                  <td className="py-0.5 pl-1 text-right">{it.accNo ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {exemptTotal > 0 && (
          <div className="mt-1 font-semibold">Total Exempted Taxable Amount (SVE) : {ccy} {n2(exemptTotal)}</div>
        )}

        {/* ── Amount in words + notes ── */}
        <div className="mt-2">
          {note.notes && <div className="whitespace-pre-line"><span className="font-semibold">REMARK :</span> {note.notes}</div>}
          <div className="mt-1 font-medium">{ccy} : {amountInWords(note.totalAmount)}</div>
        </div>

        {/* ── Bank + totals ── */}
        <div className="grid grid-cols-[1.3fr_1fr] gap-6 mt-3">
          <div>
            <div className="font-semibold">BANK INFORMATION :</div>
            <div className="flex"><span className="w-32 shrink-0">BANK</span><span className="pr-1">:</span><span>{BANK_INFO.bank}</span></div>
            <div className="flex"><span className="w-32 shrink-0">BRANCH</span><span className="pr-1">:</span><span>{BANK_INFO.branch}</span></div>
            {BANK_INFO.accounts.map((a) => (
              <div key={a.currency} className="flex"><span className="w-32 shrink-0">A/C NO. ({a.currency})</span><span className="pr-1">:</span><span>{a.number}</span></div>
            ))}
            <div className="flex"><span className="w-32 shrink-0">SWIFT CODE</span><span className="pr-1">:</span><span>{BANK_INFO.swift}</span></div>
          </div>
          <table className="self-start ml-auto"><tbody>
            <tr><td className="pr-4">TOTAL (EXCLUDING TAX)</td><td className="pr-1">:</td><td className="pr-2">{ccy}</td><td className="text-right font-semibold w-28">{n2(note.subtotal)}</td></tr>
            <tr><td className="pr-4">TOTAL SERVICE TAX</td><td className="pr-1">:</td><td className="pr-2">{ccy}</td><td className="text-right font-semibold">{n2(note.taxAmt)}</td></tr>
            <tr className="text-[12px]"><td className="pr-4 font-bold">TOTAL (INCLUSIVE OF TAX)</td><td className="pr-1">:</td><td className="pr-2 font-bold">{ccy}</td><td className="text-right font-bold border-t border-black">{n2(note.totalAmount)}</td></tr>
          </tbody></table>
        </div>

        {/* ── Footer ── */}
        <div className="mt-4 text-[9px] leading-tight border-t border-gray-400 pt-2">
          <div>{INVOICE_FOOTER.tradingCondition}</div>
          {note.type === 'CREDIT'
            ? <div className="font-semibold mt-1">This credit note adjusts the referenced invoice. No cheque is attached.</div>
            : <div className="font-semibold mt-1">{INVOICE_FOOTER.chequeNote}</div>}
        </div>
      </div>
    </div>
  );
}
