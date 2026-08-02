'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Star, Trophy, Upload } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ImportDialog } from '@/components/import-dialog';
import { ErrorText, GpBadge, Modal, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, downloadCsv, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { CreditPanel } from './credit-panel';
import { CustomerModal } from './customer-form';
import { StatementPanel } from './statement-panel';

interface Customer {
  id: string; code: string; companyName: string; pic?: string | null; paymentTerm?: string | null;
  priority?: number | null; status?: string | null; vip?: boolean; blacklist?: boolean;
  totalRevenue: number; totalProfit: number; lastQuotation: string | null; rating: number | null;
}

const ratingSchema = z.object({
  paymentSpeed: z.coerce.number().min(1).max(5),
  profitability: z.coerce.number().min(1).max(5),
  repeatBusiness: z.coerce.number().min(1).max(5),
  communication: z.coerce.number().min(1).max(5),
  complaintHistory: z.coerce.number().min(1).max(5),
  businessPotential: z.coerce.number().min(1).max(5),
  comment: z.string().optional(),
});

interface CreditRow {
  customerId: string; exposure: number; effectiveLimit: number | null;
  headroom: number | null; creditHold: boolean; wouldBlock: boolean;
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [creditFor, setCreditFor] = useState<Customer | null>(null);
  const [statementFor, setStatementFor] = useState<Customer | null>(null);
  // Phase B: credit standing on the list, plus an "at risk" view driven by the
  // same dry-run report enforcement uses — one rule, not a second definition.
  const [creditFilter, setCreditFilter] = useState<'' | 'atRisk'>('');
  const [rating, setRating] = useState<Customer | null>(null);
  const [showRanking, setShowRanking] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data } = useQuery({
    queryKey: ['customers', page, search],
    queryFn: () => api<{ items: Customer[]; total: number; pageCount: number }>(`/customers?page=${page}&search=${encodeURIComponent(search)}`),
  });

  // Credit standing for the customers on this page — ONE batch call, never one
  // request per row.
  const pageIds = (data?.items ?? []).map((c) => c.id);
  const { data: creditSummary } = useQuery({
    queryKey: ['customer-credit-summary', pageIds.join(',')],
    queryFn: () => api<{ rows: CreditRow[] }>(`/customers/credit/summary?ids=${pageIds.join(',')}`),
    enabled: pageIds.length > 0,
  });
  const creditByCustomer = new Map((creditSummary?.rows ?? []).map((r) => [r.customerId, r]));

  // "Would be blocked" reuses the dry-run report that enforcement itself is
  // measured by, so the list can never disagree with the block.
  const { data: atRisk } = useQuery({
    queryKey: ['customer-credit-at-risk'],
    queryFn: () => api<{ totalAffected: number; rows: { customerId: string }[] }>('/customers/credit/over-limit'),
    enabled: creditFilter === 'atRisk',
  });
  const atRiskIds = new Set((atRisk?.rows ?? []).map((r) => r.customerId));
  const rows = creditFilter === 'atRisk'
    ? (data?.items ?? []).filter((c) => atRiskIds.has(c.id))
    : (data?.items ?? []);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });

  const canWrite = hasPermission('customers.write');

  return (
    <Shell title="Customers" actions={
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setShowRanking(true)}><Trophy size={15} /> Ranking</button>
        <button className="btn-ghost" onClick={() => downloadCsv('/reports/customers/export', 'customers.csv')}>Export CSV</button>
        {canWrite && <button className="btn-ghost" onClick={() => setShowImport(true)}><Upload size={15} /> Import CSV</button>}
        {canWrite && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Customer</button>}
      </div>
    }>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-md" placeholder="Search company, code, PIC, email…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[220px]" value={creditFilter}
          onChange={(e) => setCreditFilter(e.target.value as '' | 'atRisk')}>
          <option value="">All customers</option>
          <option value="atRisk">Credit: would be blocked</option>
        </select>
      </div>

      {creditFilter === 'atRisk' && atRisk && (
        <p className="text-sm text-gray-500 mb-3">
          {atRisk.totalAffected === 0
            ? 'No customer would be blocked today.'
            : `${atRisk.totalAffected} customer${atRisk.totalAffected === 1 ? '' : 's'} would have an invoice refused today.`}
        </p>
      )}

      <Table head={['Code', 'Company', 'PIC', 'Payment Term', 'Credit', 'Revenue', 'Profit', 'Rating', 'Last Quote', 'Status', '']}
        empty={rows.length === 0}>
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="td font-medium text-primary">{c.code}</td>
            <td className="td font-medium">
              {c.companyName}
              {c.vip && <span className="badge ml-1.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">VIP</span>}
              {c.blacklist && <span className="badge ml-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">Blacklist</span>}
            </td>
            <td className="td text-gray-500">{c.pic || '-'}</td>
            <td className="td text-gray-500">{c.paymentTerm || '-'}</td>
            <td className="td">
              {(() => {
                const cr = creditByCustomer.get(c.id);
                if (!cr) return <span className="text-gray-400">-</span>;
                if (cr.creditHold) return <span className="badge bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">On hold</span>;
                if (cr.effectiveLimit === null) return <span className="text-gray-400" title="No limit configured — never blocked">No limit</span>;
                return (
                  <span className={cr.wouldBlock ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-300'}>
                    {fmtMoney(cr.exposure)} / {fmtMoney(cr.effectiveLimit)}
                    {cr.wouldBlock && <span className="badge ml-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">Blocked</span>}
                  </span>
                );
              })()}
            </td>
            <td className="td">{fmtMoney(c.totalRevenue)}</td>
            <td className="td text-emerald-600">{fmtMoney(c.totalProfit)}</td>
            <td className="td">{c.rating != null ? `${Number(c.rating).toFixed(2)} / 5` : '-'}</td>
            <td className="td text-gray-500">{fmtDate(c.lastQuotation)}</td>
            <td className="td"><StatusBadge status={c.status ?? 'ACTIVE'} /></td>
            <td className="td whitespace-nowrap">
              <button className="text-primary hover:underline text-sm mr-2" onClick={() => setCreditFor(c)}>Credit</button>
              <button className="text-primary hover:underline text-sm mr-2" onClick={() => setStatementFor(c)}>Statement</button>
              {canWrite && <>
                <button className="text-primary hover:underline text-sm mr-2" onClick={() => setEditing(c)}>Edit</button>
                {hasPermission('ratings.write') && <button className="text-amber-500 hover:underline text-sm mr-2" onClick={() => setRating(c)}><Star size={13} className="inline" /> Rate</button>}
                <button className="text-red-500 hover:underline text-sm" onClick={() => confirm(`Delete ${c.companyName}?`) && remove.mutate(c.id)}>Delete</button>
              </>}
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {editing && <CustomerModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {creditFor && <CreditPanel customerId={creditFor.id} customerName={creditFor.companyName} onClose={() => setCreditFor(null)} />}
      {statementFor && <StatementPanel customerId={statementFor.id} customerName={statementFor.companyName} onClose={() => setStatementFor(null)} />}
      {rating && <RatingModal customer={rating} onClose={() => setRating(null)} />}
      {showRanking && <RankingModal onClose={() => setShowRanking(false)} />}
      {showImport && (
        <ImportDialog title="Import Customers from CSV" endpoint="/imports/customers"
          invalidateKey="customers" columnsHint="companyName, email, phone, industry, paymentTerm"
          onClose={() => setShowImport(false)} />
      )}
    </Shell>
  );
}

/** KPI-based customer scoring — six criteria; overall is weighted server-side. */
function RatingModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const qc = useQueryClient();
  type RatingForm = z.infer<typeof ratingSchema>;
  const { register, handleSubmit } = useForm<RatingForm>({ resolver: zodResolver(ratingSchema), defaultValues: { paymentSpeed: 3, profitability: 3, repeatBusiness: 3, communication: 3, complaintHistory: 3, businessPotential: 3 } });
  const save = useMutation({
    mutationFn: (form: RatingForm) =>
      api('/ratings/customer', { method: 'POST', body: JSON.stringify({ ...form, customerId: customer.id }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); },
  });
  const criteria: [Exclude<keyof RatingForm, 'comment'>, string][] = [
    ['paymentSpeed', 'Payment Speed'], ['profitability', 'Profitability'], ['repeatBusiness', 'Repeat Business'],
    ['communication', 'Communication'], ['complaintHistory', 'Complaint History (5 = none)'], ['businessPotential', 'Business Potential'],
  ];
  return (
    <Modal title={`Rate ${customer.companyName}`} onClose={onClose}>
      <form onSubmit={handleSubmit((f) => save.mutate(f))} className="space-y-3">
        {criteria.map(([key, label]) => (
          <div key={key} className="grid grid-cols-2 items-center gap-3">
            <label className="label !mb-0">{label}</label>
            <select className="input" {...register(key)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </div>
        ))}
        <div><label className="label">Comment</label><textarea className="input" rows={2} {...register('comment')} /></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Submit Rating</button>
      </form>
    </Modal>
  );
}

function RankingModal({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['customer-ranking'],
    queryFn: () => api<{ rank: number; companyName: string; revenue: number; profit: number; rating: number; score: number }[]>('/customers/ranking'),
  });
  return (
    <Modal title="Automatic Customer Ranking" onClose={onClose} wide>
      <Table head={['#', 'Customer', 'Revenue', 'Profit', 'Rating', 'Score']} empty={data?.length === 0}>
        {data?.map((r) => (
          <tr key={r.rank}>
            <td className="td font-bold">{r.rank}</td>
            <td className="td">{r.companyName}</td>
            <td className="td">{fmtMoney(r.revenue)}</td>
            <td className="td text-emerald-600">{fmtMoney(r.profit)}</td>
            <td className="td">{r.rating ? r.rating.toFixed(2) : '-'}</td>
            <td className="td"><GpBadge pct={r.score} /></td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}
