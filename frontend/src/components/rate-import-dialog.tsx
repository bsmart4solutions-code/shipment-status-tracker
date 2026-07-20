'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { ErrorText, Modal, Table } from '@/components/ui';
import { api, uploadFile } from '@/lib/api';

interface ParsedRate { origin: string; destination: string; containerType: string; cost: number; remarks?: string }
interface ParseResult { rows: ParsedRate[]; warnings: string[]; currency?: string }
interface RowResult { row: number; status: 'created' | 'skipped'; reason?: string; label?: string }
interface ImportSummary { total: number; created: number; skipped: number; results: RowResult[] }

/**
 * Ocean/vendor rate-sheet importer. The workbook is uploaded to the server,
 * which parses it with exceljs (P0-6 — no spreadsheet parser runs in the
 * browser) and returns the detected POL/POD rate rows. The user confirms
 * vendor/service/currency/effective-date, previews, and commits the rows to
 * /imports/rates exactly as before.
 */
export function RateImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: () => api<{ items: { id: string; name: string }[] }>('/vendors?pageSize=200') });
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api<{ id: string; name: string }[]>('/services') });

  const parse = useMutation({
    mutationFn: (file: File) => uploadFile<ParseResult>('/imports/rates/parse', file),
    onSuccess: (d) => {
      setRows(d.rows);
      setWarnings(d.warnings ?? []);
      if (d.currency) setCurrency(d.currency);
    },
  });

  const run = useMutation({
    mutationFn: () => api<ImportSummary>('/imports/rates', {
      method: 'POST',
      body: JSON.stringify({ vendorId, serviceId, currency, effectiveDate, rows }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setRows([]);
    setWarnings([]);
    run.reset();
    parse.mutate(file);
  };

  const summary = run.data;
  const ready = vendorId && serviceId && rows.length > 0;

  return (
    <Modal title="Import Ocean Rates from Excel" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Upload a carrier rate sheet (.xlsx, e.g. an ocean FCL tariff). The table is detected automatically —
          each container column (20&apos;, 40&apos;…) becomes its own rate. Review the preview, then import.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-ghost" disabled={parse.isPending} onClick={() => fileRef.current?.click()}>
            {parse.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {parse.isPending ? 'Parsing…' : 'Choose Excel'}
          </button>
          <span className="text-sm text-gray-500">{fileName || 'No file selected'}</span>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
        </div>

        <ErrorText error={parse.error} />
        {warnings.map((w) => <div key={w} className="text-sm text-amber-600 dark:text-amber-400">{w}</div>)}

        {rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><label className="label">Vendor (carrier)</label>
                <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
                  <option value="">— select —</option>
                  {vendors?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></div>
              <div><label className="label">Service</label>
                <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  <option value="">— select —</option>
                  {services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <div><label className="label">Currency</label>
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {['USD', 'MYR', 'SGD', 'EUR', 'CNY'].map((c) => <option key={c}>{c}</option>)}
                </select></div>
              <div><label className="label">Effective Date</label>
                <input className="input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
            </div>

            <div className="text-sm text-gray-500">{rows.length} rate lines detected:</div>
            <div className="max-h-56 overflow-y-auto">
              <Table head={['POL', 'POD', 'Container', 'Cost', 'Notes']}>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="td">{r.origin || '-'}</td>
                    <td className="td font-medium">{r.destination}</td>
                    <td className="td">{r.containerType || '-'}</td>
                    <td className="td">{currency} {r.cost.toLocaleString()}</td>
                    <td className="td text-gray-400 text-xs">{r.remarks || ''}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </>
        )}

        <ErrorText error={run.error} />

        {summary && (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="text-emerald-600 font-medium">{summary.created} created</span>{' · '}
              <span className="text-gray-500">{summary.skipped} skipped</span>{' · '}
              <span className="text-gray-400">{summary.total} total</span>
            </div>
            {summary.skipped > 0 && (
              <div className="max-h-40 overflow-y-auto">
                <Table head={['Row', 'Result', 'Detail']}>
                  {summary.results.filter((r) => r.status === 'skipped').map((r) => (
                    <tr key={r.row}>
                      <td className="td">{r.row}</td>
                      <td className="td text-gray-500">skipped</td>
                      <td className="td text-gray-500">{r.reason} {r.label ? `(${r.label})` : ''}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        )}

        <button className="btn-primary w-full justify-center" disabled={!ready || run.isPending}
          onClick={() => run.mutate()}>
          {run.isPending ? 'Importing…' : `Import ${rows.length} rate${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
