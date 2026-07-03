'use client';

import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Card } from '@/components/ui';
import { downloadCsv } from '@/lib/api';

const REPORTS = [
  { type: 'quotations', name: 'Quotation Report', desc: 'All quotations with cost, sell, GP and status' },
  { type: 'vendors', name: 'Vendor Report', desc: 'Vendor master with ratings, rates and job counts' },
  { type: 'customers', name: 'Customer Report', desc: 'Customer master with revenue and profit' },
  { type: 'pnl', name: 'P&L Report', desc: 'Revenue, vendor cost, GP and margin by month', params: '?groupBy=month' },
  { type: 'customer-profitability', name: 'Customer Profitability Report', desc: 'Revenue, GP and margin per customer' },
  { type: 'sales', name: 'Sales Report', desc: 'Revenue and GP by sales person', params: '?groupBy=salesperson' },
  { type: 'revenue', name: 'Revenue Report', desc: 'Monthly revenue breakdown', params: '?groupBy=month' },
  { type: 'gross-profit', name: 'Gross Profit Report', desc: 'Monthly gross profit breakdown', params: '?groupBy=month' },
];

export default function ReportsPage() {
  const [busy, setBusy] = useState('');

  async function run(type: string, params = '') {
    setBusy(type);
    try {
      await downloadCsv(`/reports/${type}/export${params}`, `${type}-report.csv`);
    } finally {
      setBusy('');
    }
  }

  return (
    <Shell title="Reports">
      <p className="text-sm text-gray-500 mb-4">
        All reports export as CSV (opens directly in Excel). Use your browser&apos;s Print → Save as PDF on any screen for PDF output.
        The Vendor Comparison report is exported from the <b>Compare Vendors</b> page with your chosen lane.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <Card key={r.type} className="flex flex-col">
            <div className="flex items-center gap-2 mb-1"><FileText size={16} className="text-primary" /><span className="font-semibold">{r.name}</span></div>
            <p className="text-sm text-gray-500 flex-1">{r.desc}</p>
            <button className="btn-primary mt-3 self-start" disabled={busy === r.type} onClick={() => run(r.type, r.params)}>
              <Download size={14} /> {busy === r.type ? 'Exporting…' : 'Export CSV / Excel'}
            </button>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
