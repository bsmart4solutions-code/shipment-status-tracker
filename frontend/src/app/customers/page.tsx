'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Star, Trophy } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, GpBadge, Modal, Pagination, StatusBadge, Table } from '@/components/ui';
import { api, downloadCsv, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

const customerSchema = z.object({
  companyName: z.string().min(1, 'Required'),
  pic: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  industry: z.string().optional(),
  paymentTerm: z.string().optional(),
  creditLimit: z.coerce.number().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  priority: z.coerce.number().min(1).max(5).default(3),
  notes: z.string().optional(),
});
type CustomerForm = z.infer<typeof customerSchema>;

interface Customer extends CustomerForm {
  id: string; code: string; totalRevenue: number; totalProfit: number;
  lastQuotation: string | null; rating: number | null;
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

export default function CustomersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [rating, setRating] = useState<Customer | null>(null);
  const [showRanking, setShowRanking] = useState(false);

  const { data } = useQuery({
    queryKey: ['customers', page, search],
    queryFn: () => api<{ items: Customer[]; total: number; pageCount: number }>(`/customers?page=${page}&search=${encodeURIComponent(search)}`),
  });

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
        {canWrite && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Customer</button>}
      </div>
    }>
      <div className="mb-4">
        <input className="input max-w-md" placeholder="Search company, code, PIC, email…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <Table head={['Code', 'Company', 'PIC', 'Payment Term', 'Priority', 'Revenue', 'Profit', 'Rating', 'Last Quote', 'Status', '']}
        empty={data?.items.length === 0}>
        {data?.items.map((c) => (
          <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="td font-medium text-primary">{c.code}</td>
            <td className="td font-medium">{c.companyName}</td>
            <td className="td text-gray-500">{c.pic || '-'}</td>
            <td className="td text-gray-500">{c.paymentTerm || '-'}</td>
            <td className="td">{'★'.repeat(6 - (c.priority ?? 3))}</td>
            <td className="td">{fmtMoney(c.totalRevenue)}</td>
            <td className="td text-emerald-600">{fmtMoney(c.totalProfit)}</td>
            <td className="td">{c.rating != null ? `${Number(c.rating).toFixed(2)} / 5` : '-'}</td>
            <td className="td text-gray-500">{fmtDate(c.lastQuotation)}</td>
            <td className="td"><StatusBadge status={c.status ?? 'ACTIVE'} /></td>
            <td className="td whitespace-nowrap">
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
      {rating && <RatingModal customer={rating} onClose={() => setRating(null)} />}
      {showRanking && <RankingModal onClose={() => setShowRanking(false)} />}
    </Shell>
  );
}

function CustomerModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ?? { status: 'ACTIVE', priority: 3 },
  });
  const save = useMutation({
    mutationFn: (form: CustomerForm) =>
      customer
        ? api(`/customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(form) })
        : api('/customers', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); },
  });

  return (
    <Modal title={customer ? `Edit ${customer.code}` : 'New Customer'} onClose={onClose}>
      <form onSubmit={handleSubmit((f) => save.mutate(f))} className="space-y-3">
        <div><label className="label">Company Name</label><input className="input" {...register('companyName')} />
          {errors.companyName && <p className="text-xs text-red-500">{errors.companyName.message}</p>}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Person In Charge</label><input className="input" {...register('pic')} /></div>
          <div><label className="label">Industry</label><input className="input" {...register('industry')} /></div>
          <div><label className="label">Phone</label><input className="input" {...register('phone')} /></div>
          <div><label className="label">Email</label><input className="input" {...register('email')} /></div>
        </div>
        <div><label className="label">Address</label><input className="input" {...register('address')} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Payment Term</label><input className="input" placeholder="NET 30" {...register('paymentTerm')} /></div>
          <div><label className="label">Credit Limit</label><input className="input" type="number" step="0.01" {...register('creditLimit')} /></div>
          <div><label className="label">Priority (1 = top)</label><input className="input" type="number" min={1} max={5} {...register('priority')} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Status</label>
            <select className="input" {...register('status')}><option>ACTIVE</option><option>INACTIVE</option></select></div>
        </div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} {...register('notes')} /></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Customer</button>
      </form>
    </Modal>
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
