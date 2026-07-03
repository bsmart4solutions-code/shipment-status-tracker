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
import { fmtMoney } from '@/lib/utils';

const vendorSchema = z.object({
  name: z.string().min(1, 'Required'),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  paymentTerm: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  isPreferred: z.boolean().default(false),
  notes: z.string().optional(),
});
type VendorForm = z.infer<typeof vendorSchema>;

interface Vendor extends VendorForm {
  id: string; code: string; rating: number | null;
  _count?: { rates: number; jobs: number };
}

const ratingSchema = z.object({
  price: z.coerce.number().min(1).max(5),
  serviceQuality: z.coerce.number().min(1).max(5),
  communication: z.coerce.number().min(1).max(5),
  deliveryPerformance: z.coerce.number().min(1).max(5),
  reliability: z.coerce.number().min(1).max(5),
  responseSpeed: z.coerce.number().min(1).max(5),
  comment: z.string().optional(),
});

export default function VendorsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [rating, setRating] = useState<Vendor | null>(null);
  const [showRanking, setShowRanking] = useState(false);

  const { data } = useQuery({
    queryKey: ['vendors', page, search],
    queryFn: () => api<{ items: Vendor[]; total: number; pageCount: number }>(`/vendors?page=${page}&search=${encodeURIComponent(search)}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/vendors/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const canWrite = hasPermission('vendors.write');

  return (
    <Shell title="Vendors" actions={
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setShowRanking(true)}><Trophy size={15} /> Ranking</button>
        <button className="btn-ghost" onClick={() => downloadCsv('/reports/vendors/export', 'vendors.csv')}>Export CSV</button>
        {canWrite && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Vendor</button>}
      </div>
    }>
      <div className="mb-4">
        <input className="input max-w-md" placeholder="Search vendor name, code, contact…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <Table head={['Code', 'Vendor', 'Contact', 'Payment Term', 'Preferred', 'Rating', 'Rates', 'Jobs', 'Status', '']}
        empty={data?.items.length === 0}>
        {data?.items.map((v) => (
          <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="td font-medium text-primary">{v.code}</td>
            <td className="td font-medium">{v.name}</td>
            <td className="td text-gray-500">{v.contactPerson || '-'}<br /><span className="text-xs">{v.phone}</span></td>
            <td className="td text-gray-500">{v.paymentTerm || '-'}</td>
            <td className="td">{v.isPreferred ? <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">★ Preferred</span> : '-'}</td>
            <td className="td">{v.rating != null ? `${Number(v.rating).toFixed(2)} / 5` : '-'}</td>
            <td className="td text-center">{v._count?.rates ?? 0}</td>
            <td className="td text-center">{v._count?.jobs ?? 0}</td>
            <td className="td"><StatusBadge status={v.status ?? 'ACTIVE'} /></td>
            <td className="td whitespace-nowrap">
              {canWrite && <>
                <button className="text-primary hover:underline text-sm mr-2" onClick={() => setEditing(v)}>Edit</button>
                {hasPermission('ratings.write') && <button className="text-amber-500 hover:underline text-sm mr-2" onClick={() => setRating(v)}><Star size={13} className="inline" /> Rate</button>}
                <button className="text-red-500 hover:underline text-sm" onClick={() => confirm(`Delete ${v.name}?`) && remove.mutate(v.id)}>Delete</button>
              </>}
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {editing && <VendorModal vendor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {rating && <RatingModal vendor={rating} onClose={() => setRating(null)} />}
      {showRanking && <RankingModal onClose={() => setShowRanking(false)} />}
    </Shell>
  );
}

function VendorModal({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<VendorForm>({
    resolver: zodResolver(vendorSchema),
    defaultValues: vendor ?? { status: 'ACTIVE', isPreferred: false },
  });
  const save = useMutation({
    mutationFn: (form: VendorForm) =>
      vendor
        ? api(`/vendors/${vendor.id}`, { method: 'PATCH', body: JSON.stringify(form) })
        : api('/vendors', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendors'] }); onClose(); },
  });
  return (
    <Modal title={vendor ? `Edit ${vendor.code}` : 'New Vendor'} onClose={onClose}>
      <form onSubmit={handleSubmit((f) => save.mutate(f))} className="space-y-3">
        <div><label className="label">Vendor Name</label><input className="input" {...register('name')} />
          {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Contact Person</label><input className="input" {...register('contactPerson')} /></div>
          <div><label className="label">Phone</label><input className="input" {...register('phone')} /></div>
          <div><label className="label">Email</label><input className="input" {...register('email')} /></div>
          <div><label className="label">Payment Term</label><input className="input" placeholder="NET 30" {...register('paymentTerm')} /></div>
        </div>
        <div><label className="label">Address</label><input className="input" {...register('address')} /></div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div><label className="label">Status</label>
            <select className="input" {...register('status')}><option>ACTIVE</option><option>INACTIVE</option></select></div>
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" {...register('isPreferred')} /> Preferred Vendor</label>
        </div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} {...register('notes')} /></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Vendor</button>
      </form>
    </Modal>
  );
}

/** KPI-based vendor scoring — Price / Quality / Communication / Delivery / Reliability / Response. */
function RatingModal({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const qc = useQueryClient();
  type RatingForm = z.infer<typeof ratingSchema>;
  const { register, handleSubmit } = useForm<RatingForm>({ resolver: zodResolver(ratingSchema), defaultValues: { price: 3, serviceQuality: 3, communication: 3, deliveryPerformance: 3, reliability: 3, responseSpeed: 3 } });
  const save = useMutation({
    mutationFn: (form: RatingForm) =>
      api('/ratings/vendor', { method: 'POST', body: JSON.stringify({ ...form, vendorId: vendor.id }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendors'] }); onClose(); },
  });
  const criteria: [Exclude<keyof RatingForm, 'comment'>, string][] = [
    ['price', 'Price'], ['serviceQuality', 'Service Quality'], ['communication', 'Communication'],
    ['deliveryPerformance', 'Delivery Performance'], ['reliability', 'Reliability'], ['responseSpeed', 'Response Speed'],
  ];
  return (
    <Modal title={`Rate ${vendor.name}`} onClose={onClose}>
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
    queryKey: ['vendor-ranking'],
    queryFn: () => api<{ rank: number; name: string; rating: number; totalSpend: number; isPreferred: boolean; score: number }[]>('/vendors/ranking'),
  });
  return (
    <Modal title="Automatic Vendor Ranking" onClose={onClose} wide>
      <Table head={['#', 'Vendor', 'Rating', 'Total Spend', 'Preferred', 'Score']} empty={data?.length === 0}>
        {data?.map((r) => (
          <tr key={r.rank}>
            <td className="td font-bold">{r.rank}</td>
            <td className="td">{r.name}</td>
            <td className="td">{r.rating ? r.rating.toFixed(2) : '-'}</td>
            <td className="td">{fmtMoney(r.totalSpend)}</td>
            <td className="td">{r.isPreferred ? '★' : '-'}</td>
            <td className="td"><GpBadge pct={r.score} /></td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}
