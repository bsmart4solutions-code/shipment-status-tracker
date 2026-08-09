'use client';

/**
 * Printable Statement of Account.
 *
 * Same ledger the on-screen panel shows, on the house letterhead, so a customer
 * asking for "a copy for our records" gets one instead of a screenshot.
 *
 * The mixed-currency and FX caveats the panel displays are reproduced here on
 * purpose. A printed statement outlives the screen it came from — dropping the
 * qualifier would leave a document stating a balance more precisely than the
 * data supports, and that is the version that ends up in a dispute.
 */

import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useCompany, INVOICE_FOOTER } from '@/lib/company';

interface StatementRow {
  date: string; type: string; ref: string; currency: string; debit: number; credit: number; balance: number;
}
interface Statement {
  customer: { id: string; name: string; code: string; email: string | null; currency: string | null };
  asOfDate: string; rows: StatementRow[]; mixedCurrency: boolean;
  nativeClosingBalance: number; baseCurrencyExposure: number; fxWarning: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice', PAYMENT: 'Payment', CREDIT_NOTE: 'Credit Note', DEBIT_NOTE: 'Debit Note',
};

const dmy = (d: string | null | undefined) => {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};
const n2 = (v: number) => Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StatementPrint({ params }: { params: { id: string } }) {
  const router = useRouter();
  const search = useSearchParams();
  const COMPANY = useCompany();
  // Optional ?asOf=YYYY-MM-DD so a month-end statement can be reprinted
  // exactly as it stood, rather than only ever "as of today".
  const asOf = search.get('asOf');
  const qs = asOf ? `?asOfDate=${encodeURIComponent(asOf)}` : '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['statement-print', params.id, asOf],
    queryFn: () => api<Statement>(`/customers/${params.id}/statement${qs}`),
  });

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading…</div>;
  if (error || !data) return <div className="p-10 text-center text-red-500 text-sm">Could not load this statement.</div>;

  const totalDebit = data.rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = data.rows.reduce((s, r) => s + r.credit, 0);
  const ccy = data.customer.currency || data.rows[0]?.currency || '';

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-300 px-6 py-3 flex items-center gap-3">
        <button className="btn-ghost" onClick={() => router.push('/customers')}><ArrowLeft size={15} /> Back</button>
        <span className="text-sm text-gray-500">{data.customer.name} — statement preview</span>
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
            <div className="text-[17px] font-bold tracking-widest">STATEMENT</div>
            <div className="text-[17px] font-bold tracking-widest">OF ACCOUNT</div>
          </div>
        </div>

        {/* ── Customer + as-of ── */}
        <div className="grid grid-cols-[1.5fr_1fr] gap-6 mt-3">
          <div>
            <div>TO :</div>
            <div className="font-semibold">{data.customer.name}</div>
            <div>A/C CODE : {data.customer.code}</div>
            {data.customer.email && <div>EMAIL : {data.customer.email}</div>}
          </div>
          <table className="self-start"><tbody>
            <tr><td className="pr-2 whitespace-nowrap">AS OF</td><td className="pr-1">:</td><td className="font-semibold">{dmy(data.asOfDate)}</td></tr>
            <tr><td className="pr-2">PRINTED</td><td className="pr-1">:</td><td>{dmy(new Date().toISOString())}</td></tr>
          </tbody></table>
        </div>

        {/* ── Ledger ── */}
        <table className="w-full mt-4 border-collapse">
          <thead>
            <tr className="border-y-2 border-black text-left">
              <th className="py-1 pr-2 font-semibold">Date</th>
              <th className="py-1 px-1 font-semibold">Type</th>
              <th className="py-1 px-1 font-semibold">Reference</th>
              <th className="py-1 px-1 font-semibold">Ccy</th>
              <th className="py-1 px-1 font-semibold text-right">Debit</th>
              <th className="py-1 px-1 font-semibold text-right">Credit</th>
              <th className="py-1 pl-1 font-semibold text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-center text-gray-500">No transactions in this period.</td></tr>
            )}
            {data.rows.map((r, i) => (
              <tr key={`${r.ref}-${i}`} className="align-top border-b border-gray-200">
                <td className="py-0.5 pr-2 whitespace-nowrap">{dmy(r.date)}</td>
                <td className="py-0.5 px-1">{TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="py-0.5 px-1 font-medium">{r.ref}</td>
                <td className="py-0.5 px-1">{r.currency}</td>
                <td className="py-0.5 px-1 text-right">{r.debit ? n2(r.debit) : ''}</td>
                <td className="py-0.5 px-1 text-right">{r.credit ? n2(r.credit) : ''}</td>
                <td className="py-0.5 pl-1 text-right font-medium">{n2(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-semibold">
              <td className="py-1 pr-2" colSpan={4}>TOTAL</td>
              <td className="py-1 px-1 text-right">{n2(totalDebit)}</td>
              <td className="py-1 px-1 text-right">{n2(totalCredit)}</td>
              <td className="py-1 pl-1 text-right">{n2(data.nativeClosingBalance)}</td>
            </tr>
          </tfoot>
        </table>

        {/* ── Closing balance ── */}
        <div className="flex justify-end mt-3">
          <table><tbody>
            <tr className="text-[13px]">
              <td className="pr-4 font-bold">BALANCE DUE</td>
              <td className="pr-1 font-bold">:</td>
              <td className="pr-2 font-bold">{ccy}</td>
              <td className="text-right font-bold border-t-2 border-b-4 border-double border-black w-32">
                {n2(data.nativeClosingBalance)}
              </td>
            </tr>
          </tbody></table>
        </div>

        {/* ── Caveats, carried over from the screen deliberately ── */}
        {data.mixedCurrency && (
          <div className="mt-3 border border-black p-2 text-[9.5px]">
            <span className="font-semibold">Note :</span> this account holds documents in more than one currency.
            The running balance above is a convenience total in the document currencies shown; the authoritative
            figure is the base-currency exposure below.
          </div>
        )}
        {data.fxWarning && (
          <div className="mt-2 border border-black p-2 text-[9.5px]">
            <span className="font-semibold">Exchange rate incomplete :</span> {data.fxWarning}
          </div>
        )}
        {(data.mixedCurrency || data.fxWarning) && (
          <div className="mt-2 text-[10px] font-semibold">
            Base-currency exposure : {n2(data.baseCurrencyExposure)}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-6 text-[9px] leading-tight border-t border-gray-400 pt-2">
          <div>Please remit payment for the balance shown above. If you believe any entry is incorrect, contact us within 7 days of this statement.</div>
          <div className="mt-1">{INVOICE_FOOTER.tradingCondition}</div>
        </div>
      </div>
    </div>
  );
}
