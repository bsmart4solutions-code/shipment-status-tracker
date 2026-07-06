'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ErrorText, Modal, Table } from '@/components/ui';
import { api } from '@/lib/api';

interface ParsedRate { origin: string; destination: string; containerType: string; cost: number; remarks?: string }
interface RowResult { row: number; status: 'created' | 'skipped'; reason?: string; label?: string }
interface ImportSummary { total: number; created: number; skipped: number; results: RowResult[] }

/**
 * Ocean/vendor rate-sheet importer. Parses an Excel file in the browser with
 * SheetJS, auto-detects the POL/POD rate table (skipping the carrier's letterhead
 * and footnotes), expands each container-size column (20'/40'/40HC…) into its own
 * rate row, lets the user confirm vendor/service/currency/effective-date, previews
 * the result, and posts confirmed rows to /imports/rates.
 */
export function RateImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRate[]>([]);
  const [parseError, setParseError] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: () => api<{ items: { id: string; name: string }[] }>('/vendors?pageSize=200') });
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api<{ id: string; name: string }[]>('/services') });

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
    setParseError('');
    setRows([]);
    run.reset();
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false }) as unknown[][];
        const parsed = extractRates(grid);
        if (parsed.length === 0) setParseError('Could not find a POL/POD rate table in this sheet. Check the first tab has a header row with POL and POD columns.');
        setRows(parsed);
        // Best-effort currency auto-detect from the header text.
        const flat = grid.flat().map((c) => String(c ?? '').toUpperCase()).join(' ');
        const cur = ['USD', 'MYR', 'SGD', 'EUR', 'CNY'].find((c) => flat.includes(c));
        if (cur) setCurrency(cur);
      } catch (e) {
        setParseError(`Failed to read the Excel file: ${(e as Error).message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const summary = run.data;
  const ready = vendorId && serviceId && rows.length > 0;

  return (
    <Modal title="Import Ocean Rates from Excel" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Upload a carrier rate sheet (e.g. an ocean FCL tariff). The table is detected automatically —
          each container column (20&apos;, 40&apos;…) becomes its own rate. Review the preview, then import.
        </p>

        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Choose Excel
          </button>
          <span className="text-sm text-gray-500">{fileName || 'No file selected'}</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
        </div>

        {parseError && <div className="text-sm text-red-500">{parseError}</div>}

        {rows.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-3">
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

/**
 * Extract rate rows from a raw 2D cell grid. Finds the header row (contains
 * both a POL and a POD column), identifies the container-size columns from it,
 * then reads each subsequent data row until the table ends, emitting one rate
 * per container column that holds a number. Exported for unit testing.
 */
export function extractRates(grid: unknown[][]): ParsedRate[] {
  const norm = (v: unknown) => String(v ?? '').trim();
  const lower = (v: unknown) => norm(v).toLowerCase();

  let headerIdx = -1;
  let polCol = -1;
  let podCol = -1;
  for (let i = 0; i < grid.length; i++) {
    // Array.from densifies sparse rows (SheetJS leaves holes) so cells are never undefined.
    const rowCells = Array.from(grid[i] ?? [], (x) => lower(x));
    const pol = rowCells.findIndex((c) => c === 'pol' || c.includes('port of load') || c.includes('loading'));
    const pod = rowCells.findIndex((c) => c === 'pod' || c.includes('port of discharge') || c.includes('discharge') || c.includes('destination'));
    if (pol !== -1 && pod !== -1) { headerIdx = i; polCol = pol; podCol = pod; break; }
  }
  if (headerIdx === -1) return [];

  // Container columns: header cells that look like a container size.
  const header = grid[headerIdx];
  const containerCols: { col: number; label: string }[] = [];
  const sizeRe = /\b(20|40|45)\s*('|ft|feet|gp|hc|hq|rf|teu|feu)?/i;
  for (let c = 0; c < header.length; c++) {
    if (c === polCol || c === podCol) continue;
    const txt = norm(header[c]);
    const m = txt.match(sizeRe);
    if (m) {
      const size = m[1];
      const hc = /hc|hq/i.test(txt) ? 'HC' : '';
      containerCols.push({ col: c, label: `${size}FT${hc}` });
    }
  }
  if (containerCols.length === 0) return [];

  const lastContainerCol = Math.max(...containerCols.map((c) => c.col));
  const out: ParsedRate[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const origin = norm(row[polCol]);
    const destination = norm(row[podCol]);
    if (!destination) continue; // footnote / blank
    // A destination cell that's clearly prose (a sentence) ends the table.
    if (destination.split(' ').length > 6) continue;
    // A trailing text cell (past the numeric columns) is usually a carrier note
    // like "*Hai Yun*" — capture it so same-lane alternates stay distinct.
    let remarks = '';
    for (let c = lastContainerCol + 1; c < row.length; c++) {
      const t = norm(row[c]).replace(/["*]/g, '').trim();
      if (t && !/^\d+(\.\d+)?$/.test(t) && !/^(usd|myr|sgd)?\s*\d/i.test(t)) { remarks = t; break; }
    }
    for (const cc of containerCols) {
      const raw = row[cc.col];
      const num = typeof raw === 'number' ? raw : parseFloat(norm(raw).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(num) && num > 0) {
        out.push({ origin, destination, containerType: cc.label, cost: num, remarks: remarks || undefined });
      }
    }
  }
  return out;
}
