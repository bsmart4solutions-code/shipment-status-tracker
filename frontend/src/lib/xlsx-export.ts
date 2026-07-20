/**
 * Export rows to a real .xlsx workbook, client-side (exceljs — generation
 * only, no untrusted input is ever parsed here). `rows` are plain objects;
 * keys become the header row in insertion order. Values are written as-is so
 * numbers stay numbers in Excel. exceljs is imported dynamically so its
 * weight only loads when an export actually runs.
 */
export async function exportToXlsx(filename: string, rows: Record<string, unknown>[], sheetName = 'Data') {
  if (rows.length === 0) return;
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  const headers = Object.keys(rows[0]);
  // Reasonable column widths from header + sample content length.
  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(40, Math.max(h.length, ...rows.slice(0, 50).map((r) => String(r[h] ?? '').length)) + 2),
  }));
  for (const row of rows) ws.addRow(row);
  ws.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
