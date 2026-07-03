'use client';

/**
 * Vendor Comparison — key feature. Pick a service + lane and instantly see
 * every vendor's cost, rating, preferred flag and recommendation score,
 * with sorting, filtering and historical (expired) rates.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Download } from 'lucide-react';
import { Shell } from '@/components/shell';
import { Card, GpBadge, Table } from '@/components/ui';
import { api, downloadCsv } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';

interface CompareItem {
  rateId: string; vendor: string; vendorCode: string; service: string;
  origin: string | null; destination: string | null; rateType: string;
  currency: string; cost: number; minimumCharge: number | null; rating: number;
  isPreferred: boolean; effectiveDate: string; expiryDate: string | null;
  isExpired: boolean; score: number;
}

export default function ComparePage() {
  const [serviceId, setServiceId] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [sort, setSort] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);

  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api<{ id: string; name: string }[]>('/services') });

  const params = new URLSearchParams();
  if (serviceId) params.set('serviceId', serviceId);
  if (origin) params.set('origin', origin);
  if (destination) params.set('destination', destination);
  if (sort) params.set('sort', sort);
  if (includeExpired) params.set('includeExpired', 'true');

  const { data, isFetching } = useQuery({
    queryKey: ['compare', params.toString()],
    queryFn: () => api<{ items: CompareItem[]; recommendation: CompareItem | null }>(`/rates/compare?${params}`),
    enabled: !!serviceId,
  });

  return (
    <Shell title="Vendor Comparison" actions={
      serviceId ? (
        <button className="btn-ghost" onClick={() => downloadCsv(`/reports/vendor-comparison/export?${params}`, 'vendor-comparison.csv')}>
          <Download size={15} /> Export
        </button>
      ) : undefined
    }>
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="label">Service</label>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">— select service —</option>
              {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label className="label">Origin</label><input className="input" placeholder="e.g. Kuala Lumpur" value={origin} onChange={(e) => setOrigin(e.target.value)} /></div>
          <div><label className="label">Destination</label><input className="input" placeholder="e.g. Kuching" value={destination} onChange={(e) => setDestination(e.target.value)} /></div>
          <div>
            <label className="label">Sort By</label>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">Best Score (recommended)</option>
              <option value="cost">Lowest Cost</option>
              <option value="rating">Highest Rating</option>
              <option value="preferred">Preferred Vendor</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} />
            Include historical rates
          </label>
        </div>
      </Card>

      {!serviceId && <p className="text-gray-400 text-sm">Select a service to compare vendors.</p>}
      {isFetching && <p className="text-gray-400 text-sm">Comparing…</p>}

      {data?.recommendation && (
        <div className="card p-4 mb-4 border-l-4 !border-l-emerald-500 flex items-center gap-4">
          <div className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-full p-2"><Award size={22} /></div>
          <div>
            <div className="text-xs uppercase font-semibold text-emerald-600">Recommended Vendor</div>
            <div className="font-bold">{data.recommendation.vendor} — {fmtMoney(data.recommendation.cost, data.recommendation.currency)} <span className="text-sm text-gray-500">({data.recommendation.rateType.replace('_', ' ')})</span></div>
            <div className="text-xs text-gray-500">Rating {data.recommendation.rating.toFixed(2)} / 5 · Score {data.recommendation.score} {data.recommendation.isPreferred && '· ★ Preferred'}</div>
          </div>
        </div>
      )}

      {data && (
        <Table head={['Vendor', 'Cost', 'Min Charge', 'Rate Type', 'Rating', 'Preferred', 'Effective', 'Expiry', 'Score']} empty={data.items.length === 0}>
          {data.items.map((i) => (
            <tr key={i.rateId} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${i.isExpired ? 'opacity-50' : ''}`}>
              <td className="td font-medium">{i.vendor} <span className="text-xs text-gray-400">{i.vendorCode}</span></td>
              <td className="td font-bold">{fmtMoney(i.cost, i.currency)}</td>
              <td className="td text-gray-500">{i.minimumCharge != null ? fmtMoney(i.minimumCharge, i.currency) : '-'}</td>
              <td className="td"><span className="badge bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">{i.rateType.replace('_', ' ')}</span></td>
              <td className="td">{i.rating.toFixed(2)} / 5</td>
              <td className="td">{i.isPreferred ? '★' : '-'}</td>
              <td className="td text-gray-500">{fmtDate(i.effectiveDate)}</td>
              <td className={`td ${i.isExpired ? 'text-red-500' : 'text-gray-500'}`}>{fmtDate(i.expiryDate)}{i.isExpired && ' (hist.)'}</td>
              <td className="td"><GpBadge pct={i.score} /></td>
            </tr>
          ))}
        </Table>
      )}
    </Shell>
  );
}
