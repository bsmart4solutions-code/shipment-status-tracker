'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Printer } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Card, ErrorText, GpBadge, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

interface QuoteDetail {
  id: string; quoteNumber: string; quoteDate: string; validityDate: string | null;
  status: string; currency: string; remark: string | null;
  totalCost: string; subtotalSell: string; discountAmt: string; taxPct: string;
  taxAmt: string; miscCharge: string; sellingPrice: string; grossProfit: string; gpPercent: string;
  customer: { companyName: string; code: string; paymentTerm: string | null };
  salesPerson: { fullName: string } | null;
  items: {
    id: string; description: string | null; quantity: string; unit: string | null;
    costCurrency: string; fxRate: string; unitCost: string; markupPct: string;
    unitSell: string; totalCost: string; totalSell: string; grossProfit: string; gpPercent: string;
    service: { name: string }; vendor: { name: string } | null;
  }[];
  jobs: { id: string; jobNumber: string; status: string }[];
}

export default function QuotationDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const router = useRouter();

  const { data: q } = useQuery({ queryKey: ['quotation', id], queryFn: () => api<QuoteDetail>(`/quotations/${id}`) });

  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotation', id] }); qc.invalidateQueries({ queryKey: ['quotations'] }); },
  });

  const convert = useMutation({
    mutationFn: () => api<{ id: string; jobNumber: string }>(`/quotations/${id}/convert`, { method: 'POST' }),
    onSuccess: (job) => {
      qc.invalidateQueries();
      router.push(`/jobs?highlight=${job.id}`);
    },
  });

  const canWrite = hasPermission('quotations.write');
  if (!q) return <Shell title="Quotation">Loading…</Shell>;

  return (
    <Shell title={q.quoteNumber} actions={
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
        {canWrite && q.status !== 'WON' && (
          <button className="btn-primary" onClick={() => convert.mutate()} disabled={convert.isPending}>
            <ArrowRightLeft size={15} /> Convert to Job
          </button>
        )}
      </div>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Customer</div>
            <div className="font-bold">{q.customer.companyName}</div>
            <div className="text-sm text-gray-500">{q.customer.code} · {q.customer.paymentTerm ?? 'No terms'}</div>
          </Card>
          <Card>
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Quotation</div>
            <div className="text-sm">Date: <b>{fmtDate(q.quoteDate)}</b> · Valid until: <b>{fmtDate(q.validityDate)}</b></div>
            <div className="text-sm">Sales: <b>{q.salesPerson?.fullName ?? '-'}</b> · Currency: <b>{q.currency}</b></div>
            <div className="mt-1"><StatusBadge status={q.status} /></div>
          </Card>
          <Card>
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Commercials</div>
            <div className="text-sm">Selling Price: <b className="text-primary">{fmtMoney(q.sellingPrice, q.currency)}</b></div>
            <div className="text-sm">Gross Profit: <b className="text-emerald-600">{fmtMoney(q.grossProfit, q.currency)}</b> <GpBadge pct={q.gpPercent} /></div>
          </Card>
        </div>

        <Table head={['Service', 'Vendor', 'Description', 'Qty', 'Unit Cost (fx)', 'Unit Sell', 'Total Cost', 'Total Sell', 'GP', 'GP %']}>
          {q.items.map((i) => (
            <tr key={i.id}>
              <td className="td font-medium">{i.service.name}</td>
              <td className="td text-gray-500">{i.vendor?.name ?? '-'}</td>
              <td className="td text-gray-500">{i.description ?? '-'}</td>
              <td className="td">{Number(i.quantity)} {i.unit ?? ''}</td>
              <td className="td">{fmtMoney(i.unitCost, i.costCurrency)}{Number(i.fxRate) !== 1 && <span className="text-xs text-gray-400"> ×{Number(i.fxRate)}</span>}</td>
              <td className="td">{fmtMoney(i.unitSell, q.currency)}</td>
              <td className="td">{fmtMoney(i.totalCost, q.currency)}</td>
              <td className="td font-medium">{fmtMoney(i.totalSell, q.currency)}</td>
              <td className="td text-emerald-600">{fmtMoney(i.grossProfit, q.currency)}</td>
              <td className="td"><GpBadge pct={i.gpPercent} /></td>
            </tr>
          ))}
        </Table>

        <div className="flex justify-end">
          <Card className="w-full max-w-sm text-sm space-y-1">
            <Row label="Subtotal" value={fmtMoney(q.subtotalSell, q.currency)} />
            <Row label="Discount" value={`− ${fmtMoney(q.discountAmt, q.currency)}`} />
            <Row label="Misc Charges" value={fmtMoney(q.miscCharge, q.currency)} />
            <Row label={`Tax (${Number(q.taxPct)}%)`} value={fmtMoney(q.taxAmt, q.currency)} />
            <div className="border-t border-gray-200 dark:border-gray-700 pt-1">
              <Row label={<b>Selling Price</b>} value={<b className="text-primary">{fmtMoney(q.sellingPrice, q.currency)}</b>} />
              <Row label="Total Vendor Cost" value={fmtMoney(q.totalCost, q.currency)} />
              <Row label={<b>Gross Profit</b>} value={<b className="text-emerald-600">{fmtMoney(q.grossProfit, q.currency)}</b>} />
            </div>
          </Card>
        </div>

        {q.remark && <Card><div className="text-xs text-gray-500 uppercase font-semibold mb-1">Remark</div><p className="text-sm">{q.remark}</p></Card>}

        {q.jobs.length > 0 && (
          <Card>
            <div className="text-xs text-gray-500 uppercase font-semibold mb-2">Linked Jobs</div>
            {q.jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-3 text-sm py-1">
                <span className="font-medium text-primary">{j.jobNumber}</span> <StatusBadge status={j.status} />
              </div>
            ))}
          </Card>
        )}

        {canWrite && (
          <Card>
            <div className="text-xs text-gray-500 uppercase font-semibold mb-2">Change Status</div>
            <div className="flex flex-wrap gap-2">
              {['DRAFT', 'SENT', 'WON', 'LOST', 'CANCELLED'].map((s) => (
                <button key={s} className={s === q.status ? 'btn-primary' : 'btn-ghost'}
                  onClick={() => setStatus.mutate(s)} disabled={setStatus.isPending || s === q.status}>{s}</button>
              ))}
            </div>
            <ErrorText error={setStatus.error || convert.error} />
          </Card>
        )}
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex justify-between"><span className="text-gray-500">{label}</span><span>{value}</span></div>;
}
