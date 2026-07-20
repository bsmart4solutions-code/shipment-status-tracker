/**
 * Ocean rate-sheet extraction — pure grid logic, moved server-side from the
 * browser (Sprint 02, P0-6) so untrusted workbooks are never parsed with the
 * unpatched `xlsx` library on the client. The extraction rules are identical
 * to the previous client implementation and covered by the same golden tests.
 */

export interface ParsedRate {
  origin: string;
  destination: string;
  containerType: string;
  cost: number;
  remarks?: string;
}

export const RATE_SHEET_LIMITS = {
  maxRows: 10_000,
  maxCols: 50,
};

/**
 * Extract rate rows from a raw 2D cell grid. Finds the header row (contains
 * both a POL and a POD column), identifies the container-size columns from it,
 * then reads each subsequent data row until the table ends, emitting one rate
 * per container column that holds a number.
 */
export function extractRates(grid: unknown[][]): ParsedRate[] {
  const norm = (v: unknown) => String(v ?? '').trim();
  const lower = (v: unknown) => norm(v).toLowerCase();

  let headerIdx = -1;
  let polCol = -1;
  let podCol = -1;
  for (let i = 0; i < grid.length; i++) {
    // Array.from densifies sparse rows so cells are never undefined.
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

/** Best-effort currency auto-detect from any cell text (same rule as the old client). */
export function detectCurrency(grid: unknown[][]): string | undefined {
  const flat = grid.flat().map((c) => String(c ?? '').toUpperCase()).join(' ');
  return ['USD', 'MYR', 'SGD', 'EUR', 'CNY'].find((c) => flat.includes(c));
}
