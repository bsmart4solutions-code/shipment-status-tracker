'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Modal, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';

interface Service { id: string; code: string; name: string; description?: string; status: string; _count?: { rates: number } }

export default function ServicesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const { data } = useQuery({ queryKey: ['services'], queryFn: () => api<Service[]>('/services') });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
  const canWrite = hasPermission('services.write');

  return (
    <Shell title="Service Catalog" actions={canWrite ? <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Service</button> : undefined}>
      <p className="text-sm text-gray-500 mb-4">Master list of services offered — unlimited entries. Each service can be priced by any number of vendors.</p>
      <Table head={['Code', 'Service', 'Description', 'Vendor Rates', 'Status', '']} empty={data?.length === 0}>
        {data?.map((s) => (
          <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="td font-medium text-primary">{s.code}</td>
            <td className="td font-medium">{s.name}</td>
            <td className="td text-gray-500">{s.description || '-'}</td>
            <td className="td text-center">{s._count?.rates ?? 0}</td>
            <td className="td"><StatusBadge status={s.status} /></td>
            <td className="td whitespace-nowrap">
              {canWrite && <>
                <button className="text-primary hover:underline text-sm mr-2" onClick={() => setEditing(s)}>Edit</button>
                <button className="text-red-500 hover:underline text-sm" onClick={() => confirm(`Delete ${s.name}?`) && remove.mutate(s.id)}>Delete</button>
              </>}
            </td>
          </tr>
        ))}
      </Table>
      {editing && <ServiceModal service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Shell>
  );
}

function ServiceModal({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [status, setStatus] = useState(service?.status ?? 'ACTIVE');
  const save = useMutation({
    mutationFn: () =>
      service
        ? api(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify({ name, description, status }) })
        : api('/services', { method: 'POST', body: JSON.stringify({ name, description }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); onClose(); },
  });
  return (
    <Modal title={service ? `Edit ${service.name}` : 'New Service'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div><label className="label">Service Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div><label className="label">Description</label><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {service && <div><label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option>ACTIVE</option><option>INACTIVE</option></select></div>}
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Service</button>
      </form>
    </Modal>
  );
}
