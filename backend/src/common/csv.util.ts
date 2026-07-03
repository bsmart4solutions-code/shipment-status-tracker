/** Minimal RFC-4180 CSV builder used by all report exports. */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  // Cells starting with =, +, -, @, tab or CR are interpreted as formulas by
  // Excel/Sheets/LibreOffice when the file is opened (CSV/formula injection,
  // CWE-1236). Report data includes user-supplied fields (customer/vendor
  // names, remarks), so prefix those leading characters with a single quote
  // to force text interpretation without changing the visible value.
  const neutralize = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
  const escape = (v: string | number | null | undefined) =>
    `"${neutralize(String(v ?? '')).replace(/"/g, '""')}"`;
  return [columns.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}
