'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Card, GpBadge, Table } from '@/components/ui';
import { api, downloadCsv } from '@/lib/api';
import { fmtMoney } from '@/lib/utils';

const GROUPS = [
  ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'],
  ['customer', 'Customer'], ['vendor', 'Vendor'], ['salesperson', 'Sales Person'], ['service', 'Service'],
] as const;

export default function PnlPage() {
  const [groupBy, setGroupBy] = useState<string>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [source, setSource] = useState<'quotes' | 'jobs'>('quotes');

  const params = new URLSearchParams({ groupBy, source });
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data } = useQuery({
    queryKey: ['pnl', params.toString()],
    queryFn: () => api<{ rows: { group: string; revenue: number; cost: number; grossProfit: number; marginPct: number; count: number }[]; totals: { revenue: number; cost: number; grossProfit: number; marginPct: number } }>(`/pnl?${params}`),
  });

  return (
    <Shell title="Profit & Loss" actions={
      <button className="btn-ghost" onClick={() => downloadCsv(`/reports/pnl/export?${params}`, `pnl-${groupBy}.csv`)}>
        <Download size={15} /> Export
      </button>
    }>
      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div><label className="label">Group By</label>
            <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div><label className="label">From</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="label">Source</label>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value as 'quotes' | 'jobs')}>
              <option value="quotes">Won Quotations (commercial)</option>
              <option value="jobs">Job Actuals (execution)</option>
            </select></div>
        </div>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card><div className="text-xs text-gray-500">Revenue</div><div className="text-xl font-bold">{fmtMoney(data.totals.revenue)}</div></Card>
            <Card><div className="text-xs text-gray-500">Vendor Cost</div><div className="text-xl font-bold text-amber-600">{fmtMoney(data.totals.cost)}</div></Card>
            <Card><div className="text-xs text-gray-500">Gross Profit</div><div className="text-xl font-bold text-emerald-600">{fmtMoney(data.totals.grossProfit)}</div></Card>
            <Card><div className="text-xs text-gray-500">Margin</div><div className="text-xl font-bold">{data.totals.marginPct.toFixed(2)}%</div></Card>
          </div>
          <Table head={[GROUPS.find(([v]) => v === groupBy)?.[1] ?? 'Group', 'Revenue', 'Vendor Cost', 'Gross Profit', 'Margin %', 'Records']} empty={data.rows.length === 0}>
            {data.rows.map((r) => (
              <tr key={r.group} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="td font-medium">{r.group}</td>
                <td className="td">{fmtMoney(r.revenue)}</td>
                <td className="td">{fmtMoney(r.cost)}</td>
                <td className="td text-emerald-600">{fmtMoney(r.grossProfit)}</td>
                <td className="td"><GpBadge pct={r.marginPct} /></td>
                <td className="td text-gray-500">{r.count}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Shell>
  );
}
