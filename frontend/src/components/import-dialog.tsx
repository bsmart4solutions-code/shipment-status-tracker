'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { ErrorText, Modal, Table } from '@/components/ui';
import { api } from '@/lib/api';

interface RowResult { row: number; status: 'created' | 'skipped'; reason?: string; label?: string }
interface ImportSummary { total: number; created: number; skipped: number; results: RowResult[] }

/**
 * Generic CSV import dialog. Reads the chosen file in the browser (no upload
 * storage) and posts its text to the given endpoint, then shows the per-row
 * created/skipped report the backend returns.
 */
export function ImportDialog({
  title, endpoint, invalidateKey, columnsHint, onClose,
}: {
  title: string;
  endpoint: string;
  invalidateKey: string;
  columnsHint: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');

  const run = useMutation({
    mutationFn: () => api<ImportSummary>(endpoint, { method: 'POST', body: JSON.stringify({ csv }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [invalidateKey] }),
  });

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const summary = run.data;

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Upload a CSV whose first row is a header. Recognised columns: <span className="font-mono text-xs">{columnsHint}</span>.
          Rows are validated individually — invalid or duplicate rows are skipped and reported below.
        </p>

        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Choose CSV
          </button>
          <span className="text-sm text-gray-500">{fileName || 'No file selected'}</span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])} />
        </div>

        <ErrorText error={run.error} />

        {summary && (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="text-emerald-600 font-medium">{summary.created} created</span>
              {' · '}
              <span className="text-gray-500">{summary.skipped} skipped</span>
              {' · '}
              <span className="text-gray-400">{summary.total} rows total</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <Table head={['Row', 'Result', 'Detail']}>
                {summary.results.map((r) => (
                  <tr key={r.row}>
                    <td className="td">{r.row}</td>
                    <td className={`td font-medium ${r.status === 'created' ? 'text-emerald-600' : 'text-gray-500'}`}>{r.status}</td>
                    <td className="td text-gray-500">{r.reason ?? r.label ?? ''}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        )}

        <button className="btn-primary w-full justify-center" disabled={!csv || run.isPending}
          onClick={() => run.mutate()}>
          {run.isPending ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
