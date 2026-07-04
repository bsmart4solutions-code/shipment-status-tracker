/**
 * Minimal, dependency-free CSV parser for import. Handles quoted fields,
 * escaped quotes ("") and commas/newlines inside quotes — enough for the
 * spreadsheets users export from Excel/Google Sheets. Returns objects keyed
 * by the (trimmed, lower-cased) header row.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = tokenizeRows(text.replace(/^﻿/, '')); // strip BOM
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip fully-empty lines.
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = (cells[idx] ?? '').trim(); });
    out.push(rec);
  }
  return out;
}

/** Split raw CSV text into rows of cells, respecting quotes. */
function tokenizeRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++; // CRLF
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += c;
    }
  }
  // Flush trailing cell/row if the file didn't end with a newline.
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
