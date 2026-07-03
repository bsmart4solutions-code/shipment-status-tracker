/** Minimal RFC-4180 CSV builder used by all report exports. */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [columns.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}
