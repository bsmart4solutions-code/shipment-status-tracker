'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ErrorText, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate } from '@/lib/utils';

interface BinItem { id: string; label: string; deletedAt: string }
interface BinGroup { entity: string; title: string; items: BinItem[] }

export default function RecycleBinPage() {
  const qc = useQueryClient();
  const canWrite = hasPermission('recycle.write');

  const { data } = useQuery({
    queryKey: ['recycle-bin'],
    queryFn: () => api<BinGroup[]>('/recycle-bin'),
  });

  const restore = useMutation({
    mutationFn: ({ entity, id }: { entity: string; id: string }) => api(`/recycle-bin/${entity}/${id}/restore`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recycle-bin'] }),
  });
  const purge = useMutation({
    mutationFn: ({ entity, id }: { entity: string; id: string }) => api(`/recycle-bin/${entity}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recycle-bin'] }),
  });

  const groups = data ?? [];
  const totalDeleted = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Shell title="Recycle Bin">
      <p className="text-sm text-gray-500 mb-4">
        Deleted records are kept here so they can be restored. Permanent deletion cannot be undone
        and is blocked if the record still has related data.
      </p>
      <ErrorText error={restore.error || purge.error} />

      {totalDeleted === 0 && (
        <div className="text-center text-gray-400 py-16">The recycle bin is empty.</div>
      )}

      {groups.filter((g) => g.items.length > 0).map((g) => (
        <div key={g.entity} className="mb-6">
          <h3 className="font-semibold mb-2">{g.title} <span className="text-gray-400 font-normal">({g.items.length})</span></h3>
          <Table head={['Name', 'Deleted', '']}>
            {g.items.map((it) => (
              <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="td font-medium">{it.label}</td>
                <td className="td text-gray-500">{fmtDate(it.deletedAt)}</td>
                <td className="td">
                  <div className="flex gap-3 justify-end">
                    {canWrite && (
                      <button className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                        onClick={() => restore.mutate({ entity: g.entity, id: it.id })}>
                        <RotateCcw size={14} /> Restore
                      </button>
                    )}
                    {canWrite && (
                      <button className="text-red-500 hover:underline text-sm inline-flex items-center gap-1"
                        onClick={() => { if (confirm(`Permanently delete "${it.label}"? This cannot be undone.`)) purge.mutate({ entity: g.entity, id: it.id }); }}>
                        <Trash2 size={14} /> Delete forever
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
    </Shell>
  );
}
