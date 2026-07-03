'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Shell } from '@/components/shell';
import { Card, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtMoney, fmtPct } from '@/lib/utils';

const PALETTE = ['#2563eb', '#0891b2', '#7c3aed', '#059669', '#d97706', '#dc2626', '#4f46e5', '#0d9488'];

interface Summary {
  revenue: number; grossProfit: number; profitMarginPct: number;
  monthRevenue: number; monthGrossProfit: number;
  quotationValue: number; quotationWinRatePct: number;
  counts: { pendingQuotations: number; wonQuotations: number; lostQuotations: number; activeJobs: number; completedJobs: number };
  monthlyTrend: { month: string; revenue: number; grossProfit: number }[];
  topCustomers: { name: string; revenue: number; grossProfit: number }[];
  topVendors: { name: string; spend: number; isPreferred: boolean }[];
  revenueByService: { service: string; revenue: number }[];
  revenueBySalesPerson: { salesPerson: string; revenue: number; grossProfit: number }[];
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Summary>('/dashboard/summary'),
    refetchInterval: 60_000, // automatic dashboard refresh
  });

  return (
    <Shell title="Executive Dashboard">
      {isLoading || !data ? (
        <p className="text-gray-400">Loading dashboard…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Revenue" value={fmtMoney(data.revenue)} />
            <StatCard label="Gross Profit" value={fmtMoney(data.grossProfit)} accent="text-emerald-600" sub={`Margin ${fmtPct(data.profitMarginPct)}`} />
            <StatCard label="Revenue This Month" value={fmtMoney(data.monthRevenue)} accent="text-cyan-600" sub={`GP ${fmtMoney(data.monthGrossProfit)}`} />
            <StatCard label="Quotation Win Rate" value={fmtPct(data.quotationWinRatePct)} accent="text-violet-600" sub={`Pipeline ${fmtMoney(data.quotationValue)}`} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Pending Quotations" value={data.counts.pendingQuotations} accent="text-amber-600" />
            <StatCard label="Won Quotations" value={data.counts.wonQuotations} accent="text-green-600" />
            <StatCard label="Lost Quotations" value={data.counts.lostQuotations} accent="text-red-500" />
            <StatCard label="Active Jobs" value={data.counts.activeJobs} accent="text-cyan-600" />
            <StatCard label="Completed Jobs" value={data.counts.completedJobs} accent="text-emerald-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-semibold mb-3">Monthly Revenue & Gross Profit Trend</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="grossProfit" name="Gross Profit" stroke="#059669" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="font-semibold mb-3">Revenue by Service</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={data.revenueByService} dataKey="revenue" nameKey="service" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {data.revenueByService.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="font-semibold mb-3">Top Customers (Revenue & Profitability)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.topCustomers} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="grossProfit" name="Profit" fill="#059669" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="font-semibold mb-3">Vendor Spending (Top Vendors)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.topVendors} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="spend" name="Spend" fill="#d97706" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card>
            <h3 className="font-semibold mb-3">Revenue by Sales Person</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.revenueBySalesPerson}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                <XAxis dataKey="salesPerson" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="grossProfit" name="Gross Profit" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </Shell>
  );
}
