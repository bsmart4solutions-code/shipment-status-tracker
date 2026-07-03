'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Modal, Pagination, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

const RATE_TYPES = ['FIXED', 'PER_KG', 'PER_CBM', 'PER_TON', 'PER_TRIP', 'PER_CONTAINER', 'PER_SHIPMENT', 'PER_HOUR', 'PER_DAY'];
const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];

const rateSchema = z.object({
  vendorId: z.string().uuid('Select a vendor'),
  serviceId: z.string().uuid('Select a service'),
  origin: z.string().optional(),
  destination: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  rateType: z.string(),
  currency: z.string(),
  cost: z.coerce.number().positive(),
  minimumCharge: z.coerce.number().optional(),
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
  remarks: z.string().optional(),
});
type RateForm = z.infer<typeof rateSchema>;

interface Rate extends RateForm {
  id: string;
  vendor: { name: string; code: string; isPreferred: boolean };
  service: { name: string };
}

export default function RatesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [editing, setEditing] = useState<Rate | 'new' | null>(null);

  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api<{ id: string; name: string }[]>('/services') });
  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: () => api<{ items: { id: string; name: string }[] }>('/vendors?pageSize=200') });

  const { data } = useQuery({
    queryKey: ['rates', page, search, serviceFilter, vendorFilter],
    queryFn: () => api<{ items: Rate[]; pageCount: number }>(
      `/rates?page=${page}&search=${encodeURIComponent(search)}${serviceFilter ? `&serviceId=${serviceFilter}` : ''}${vendorFilter ? `&vendorId=${vendorFilter}` : ''}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/rates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });

  const canWrite = hasPermission('rates.write');
  const now = new Date();

  return (
    <Shell title="Vendor Service Rates" actions={canWrite ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Rate</button> : undefined}>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-xs" placeholder="Search lane or vendor…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[200px]" value={serviceFilter} onChange={(e) => { setServiceFilter(e.target.value); setPage(1); }}>
          <option value="">All services</option>
          {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input max-w-[200px]" value={vendorFilter} onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }}>
          <option value="">All vendors</option>
          {vendors?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <Table head={['Vendor', 'Service', 'Origin', 'Destination', 'Rate Type', 'Cost', 'Min Charge', 'Effective', 'Expiry', '']} empty={data?.items.length === 0}>
        {data?.items.map((r) => {
          const expired = r.expiryDate && new Date(r.expiryDate) < now;
          return (
            <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${expired ? 'opacity-50' : ''}`}>
              <td className="td font-medium">{r.vendor.name}{r.vendor.isPreferred && ' ★'}</td>
              <td className="td">{r.service.name}</td>
              <td className="td text-gray-500">{r.origin || '-'}</td>
              <td className="td text-gray-500">{r.destination || '-'}</td>
              <td className="td"><span className="badge bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">{r.rateType.replace('_', ' ')}</span></td>
              <td className="td font-medium">{fmtMoney(r.cost, r.currency)}</td>
              <td className="td text-gray-500">{r.minimumCharge ? fmtMoney(r.minimumCharge, r.currency) : '-'}</td>
              <td className="td text-gray-500">{fmtDate(r.effectiveDate)}</td>
              <td className={`td ${expired ? 'text-red-500 font-medium' : 'text-gray-500'}`}>{fmtDate(r.expiryDate)}{expired && ' (expired)'}</td>
              <td className="td whitespace-nowrap">
                {canWrite && <>
                  <button className="text-primary hover:underline text-sm mr-2" onClick={() => setEditing(r)}>Edit</button>
                  <button className="text-red-500 hover:underline text-sm" onClick={() => confirm('Delete this rate?') && remove.mutate(r.id)}>Delete</button>
                </>}
              </td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {editing && (
        <RateModal
          rate={editing === 'new' ? null : editing}
          services={services ?? []}
          vendors={vendors?.items ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Shell>
  );
}

function RateModal({ rate, services, vendors, onClose }: {
  rate: Rate | null;
  services: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<RateForm>({
    resolver: zodResolver(rateSchema),
    defaultValues: rate
      ? { ...rate, effectiveDate: rate.effectiveDate?.slice(0, 10), expiryDate: rate.expiryDate?.slice(0, 10) ?? '' }
      : { rateType: 'FIXED', currency: 'MYR' },
  });
  const save = useMutation({
    mutationFn: (form: RateForm) => {
      const body = { ...form, minimumCharge: form.minimumCharge || undefined, expiryDate: form.expiryDate || undefined, effectiveDate: form.effectiveDate || undefined };
      return rate
        ? api(`/rates/${rate.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/rates', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rates'] }); onClose(); },
  });

  return (
    <Modal title={rate ? 'Edit Rate' : 'New Vendor Rate'} onClose={onClose}>
      <form onSubmit={handleSubmit((f) => save.mutate(f))} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Vendor</label>
            <select className="input" {...register('vendorId')}>
              <option value="">— select —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {errors.vendorId && <p className="text-xs text-red-500">{errors.vendorId.message}</p>}
          </div>
          <div><label className="label">Service</label>
            <select className="input" {...register('serviceId')}>
              <option value="">— select —</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.serviceId && <p className="text-xs text-red-500">{errors.serviceId.message}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Origin</label><input className="input" {...register('origin')} /></div>
          <div><label className="label">Destination</label><input className="input" {...register('destination')} /></div>
          <div><label className="label">Country</label><input className="input" {...register('country')} /></div>
          <div><label className="label">State</label><input className="input" {...register('state')} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Rate Type</label>
            <select className="input" {...register('rateType')}>{RATE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Currency</label>
            <select className="input" {...register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Cost</label><input className="input" type="number" step="0.0001" {...register('cost')} />
            {errors.cost && <p className="text-xs text-red-500">{errors.cost.message}</p>}</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Minimum Charge</label><input className="input" type="number" step="0.01" {...register('minimumCharge')} /></div>
          <div><label className="label">Effective Date</label><input className="input" type="date" {...register('effectiveDate')} /></div>
          <div><label className="label">Expiry Date</label><input className="input" type="date" {...register('expiryDate')} /></div>
        </div>
        <div><label className="label">Remarks</label><input className="input" {...register('remarks')} /></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Rate</button>
      </form>
    </Modal>
  );
}
