'use client';

/**
 * Printable tax invoice — replicates the company's standard INVOICE layout
 * (Solid Xpress format): letterhead, job/voyage line, bill-to + shipment
 * detail blocks, SST-aware line-item table with account codes, exempt-amount
 * line, amount-in-words, bank information and totals. Print (Ctrl+P) → "Save
 * as PDF" for the customer-facing document.
 */

import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { COMPANY, BANK_INFO, INVOICE_FOOTER } from '@/lib/company';
import { amountInWords } from '@/lib/utils';

interface PrintInvoice {
  id: string; invoiceNumber: string; issueDate: string; dueDate: string | null;
  currency: string; subtotal: string; taxPct: string; taxAmt: string; totalAmount: string; notes: string | null;
  billToCode: string | null; attn: string | null; salesman: string | null; terms: string | null; exRate: string | null;
  pol: string | null; pod: string | null; finalDestination: string | null; etd: string | null; eta: string | null;
  feederVessel: string | null; motherVessel: string | null; hblNo: string | null; oblNo: string | null;
  goods: string | null; measurement: string | null; containerInfo: string | null; noOfPackages: string | null;
  shipper: string | null; consignee: string | null;
  customer: { companyName: string; address: string | null; phone: string | null; email: string | null };
  job: { jobNumber: string } | null;
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex"><span className="w-32 shrink-0">{label}</span><span className="pr-1">:</span><span className="flex-1">{value || ''}</span></div>;
}

export default function InvoicePrintPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: inv } = useQuery({ queryKey: ['invoice', params.id], queryFn: () => api<PrintInvoice>(`/invoices/${params.id}`) });

  if (!inv) return <div className="p-10 text-center text-gray-400">Loading…</div>;

  const taxPct = Number(inv.taxPct);
  const ccy = inv.currency;
  const lineTax = (it: PrintInvoice['items'][number]) => (it.taxExempt ? 0 : Number(it.amount) * (taxPct / 100));
  const exemptTotal = inv.items.filter((i) => i.taxExempt).reduce((s, i) => s + Number(i.amount), 0);
  const vessel = [inv.feederVessel, inv.motherVessel].filter(Boolean).join(' / ');

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-300 px-6 py-3 flex items-center gap-3">
        <button className="btn-ghost" onClick={() => router.push('/invoices')}><ArrowLeft size={15} /> Back</button>
        <span className="text-sm text-gray-500">{inv.invoiceNumber} — print preview</span>
        <button className="btn-primary ml-auto" onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
      </div>

      <div className="mx-auto max-w-[210mm] bg-white text-black shadow print:shadow-none px-10 py-8 my-6 print:my-0 text-[10.5px] leading-snug font-sans">

        {/* ── Letterhead ── */}
        <div className="flex justify-between items-start border-b-2 border-black pb-2">
          <div>
            <div className="text-[15px] font-bold">{COMPANY.name}</div>
            {COMPANY.addressLines.map((l) => <div key={l}>{l}</div>)}
            <div>Tel : {COMPANY.tel}</div>
            <div>Email : {COMPANY.email}</div>
            <div>Co. No : {COMPANY.coNo}&nbsp;&nbsp;&nbsp;SST ID : {COMPANY.sstId}</div>
          </div>
          <div className="text-[20px] font-bold tracking-widest mt-1">INVOICE</div>
        </div>

        {/* ── Job / voyage line ── */}
        <div className="flex justify-between mt-2 font-semibold">
          <div>JOB NO : {inv.job?.jobNumber ?? '-'}</div>
          {(inv.etd || inv.eta) && <div>ETD POL - ETA POD : {dmy(inv.etd)} - {dmy(inv.eta)}</div>}
        </div>

        {/* ── Bill-to + meta ── */}
        <div className="grid grid-cols-[1.5fr_1fr] gap-6 mt-2">
          <div>
            <div>BILL TO :{inv.billToCode ? ` (${inv.billToCode})` : ''}</div>
            <div className="font-semibold">{inv.customer.companyName}</div>
            {inv.customer.address && <div className="whitespace-pre-line">{inv.customer.address}</div>}
            {inv.customer.phone && <div>TEL : {inv.customer.phone}</div>}
            {(inv.attn) && <div>ATTN : {inv.attn}</div>}
          </div>
          <table className="self-start"><tbody>
            <tr><td className="pr-2 whitespace-nowrap">BILL DATE</td><td className="pr-1">:</td><td>{dmy(inv.issueDate)}</td></tr>
            <tr><td className="pr-2">INVOICE NO</td><td className="pr-1">:</td><td className="font-semibold">{inv.invoiceNumber}</td></tr>
            {inv.exRate && <tr><td className="pr-2">EX. RATE</td><td className="pr-1">:</td><td>{n4(inv.exRate)}</td></tr>}
            <tr><td className="pr-2">SALESMAN</td><td className="pr-1">:</td><td>{inv.salesman ?? ''}</td></tr>
            <tr><td className="pr-2">TERMS</td><td className="pr-1">:</td><td>{inv.terms ?? ''}</td></tr>
          </tbody></table>
        </div>

        {/* ── Shipment detail block ── */}
        <div className="grid grid-cols-2 gap-x-8 mt-2 border border-black p-2">
          <div>
            <Field label="P.O.L / P.O.D" value={[inv.pol, inv.pod].filter(Boolean).join(' / ')} />
            <Field label="FINAL DESTINATION" value={inv.finalDestination} />
            <Field label="F/M. VESSEL" value={vessel} />
            <Field label="HBL NO" value={inv.hblNo} />
            <Field label="OBL NO" value={inv.oblNo} />
            <Field label="DESC. OF GOODS" value={inv.goods} />
            <Field label="MEAS./ WEIGHT" value={inv.measurement} />
          </div>
          <div>
            <Field label="SHIPPER" value={inv.shipper} />
            <Field label="CONSIGNEE" value={inv.consignee} />
            <Field label="CONTAINER" value={inv.containerInfo} />
            <Field label="NO OF PKGS." value={inv.noOfPackages} />
          </div>
        </div>

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
            {inv.items.map((it) => {
              const tax = lineTax(it);
              const lines = it.description.split('\n');
              return (
                <tr key={it.id} className="align-top">
                  <td className="py-0.5 pr-2">
                    <div className="font-medium uppercase">{lines[0]}</div>
                    {lines.slice(1).map((l, x) => <div key={x} className="text-[9px]">{l}</div>)}
                  </td>
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

        <div className="mt-2 text-center font-semibold">{INVOICE_FOOTER.computerGeneratedNote}</div>

        {/* ── Remark + amount in words ── */}
        <div className="mt-2">
          <div className="font-semibold">REMARK :</div>
          {inv.notes && <div className="whitespace-pre-line">{inv.notes}</div>}
          <div className="mt-1 font-medium">{ccy} : {amountInWords(inv.totalAmount)}</div>
        </div>

        {/* ── Bank + totals ── */}
        <div className="grid grid-cols-[1.3fr_1fr] gap-6 mt-3">
          <div>
            <div className="font-semibold">BANK INFORMATION :</div>
            <Field label="BANK" value={BANK_INFO.bank} />
            <Field label="BRANCH" value={BANK_INFO.branch} />
            {BANK_INFO.accounts.map((a) => <Field key={a.currency} label={`A/C NO. (${a.currency})`} value={a.number} />)}
            <Field label="SWIFT CODE" value={BANK_INFO.swift} />
          </div>
          <table className="self-start ml-auto"><tbody>
            <tr><td className="pr-4">TOTAL (EXCLUDING TAX)</td><td className="pr-1">:</td><td className="pr-2">{ccy}</td><td className="text-right font-semibold w-28">{n2(inv.subtotal)}</td></tr>
            <tr><td className="pr-4">TOTAL SERVICE TAX</td><td className="pr-1">:</td><td className="pr-2">{ccy}</td><td className="text-right font-semibold">{n2(inv.taxAmt)}</td></tr>
            <tr className="text-[12px]"><td className="pr-4 font-bold">TOTAL (INCLUSIVE OF TAX)</td><td className="pr-1">:</td><td className="pr-2 font-bold">{ccy}</td><td className="text-right font-bold border-t border-black">{n2(inv.totalAmount)}</td></tr>
          </tbody></table>
        </div>

        {/* ── Footer conditions ── */}
        <div className="mt-4 text-[9px] leading-tight border-t border-gray-400 pt-2">
          <div>{INVOICE_FOOTER.tradingCondition}</div>
          <div className="font-semibold mt-1">{INVOICE_FOOTER.chequeNote}</div>
        </div>
      </div>
    </div>
  );
}
