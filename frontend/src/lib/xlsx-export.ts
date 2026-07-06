import * as XLSX from 'xlsx';

/**
 * Export rows to a real .xlsx workbook, client-side (SheetJS). `rows` are
 * plain objects; keys become the header row in insertion order. Values are
 * written as-is so numbers stay numbers in Excel (no CSV re-parse dance).
 */
export function exportToXlsx(filename: string, rows: Record<string, unknown>[], sheetName = 'Data') {
  if (rows.length === 0) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  // Reasonable column widths from header + sample content length.
  const headers = Object.keys(rows[0]);
  ws['!cols'] = headers.map((h) => ({
    wch: Math.min(40, Math.max(h.length, ...rows.slice(0, 50).map((r) => String(r[h] ?? '').length)) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
