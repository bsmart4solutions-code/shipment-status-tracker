import { BadRequestException } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { detectCurrency, extractRates } from './rate-sheet.parser';

// Grid shaped like the real TCL ocean FCL sheet: letterhead rows, a POL/POD
// header with 20'/40' columns, data rows (including same-lane carrier
// alternates with a trailing carrier note), and a prose footnote.
// These are the golden tests ported verbatim from the old client-side parser
// (P0-6): the server-side extraction must produce identical rows.
const TCL_LIKE_GRID: unknown[][] = [
  ['Trans-Coastal Lines Sdn Bhd (634516-V)'],
  ['OCEAN FREIGHT FOR THE MONTH OF JULY 2026'],
  ['POL', 'POD', "20'", "40'", 'EBS'],
  ['PKG', 'JAKARTA', 100, 250, 50],
  ['PKG', 'CAT LAI', 20, 40, 50],
  ['PKG', 'CHITTAGONG', 1050, 1400, 150, '*Hai Yun*'],
  ['PKG', 'CHITTAGONG', 1200, 1300, 150, '*SM*'],
  ['We do have service to Indonesia outport. Do contact us for further enquiry.', ''],
];

describe('extractRates — ocean FCL sheet parsing (golden tests)', () => {
  const rows = extractRates(TCL_LIKE_GRID);

  it('expands each container column into its own rate row', () => {
    const jakarta = rows.filter((r) => r.destination === 'JAKARTA');
    expect(jakarta).toEqual([
      expect.objectContaining({ origin: 'PKG', containerType: '20FT', cost: 100 }),
      expect.objectContaining({ origin: 'PKG', containerType: '40FT', cost: 250 }),
    ]);
  });

  it('keeps same-lane carrier alternates as distinct rows with remarks', () => {
    const chit20 = rows.filter((r) => r.destination === 'CHITTAGONG' && r.containerType === '20FT');
    expect(chit20.map((r) => [r.cost, r.remarks])).toEqual([[1050, 'Hai Yun'], [1200, 'SM']]);
  });

  it('skips prose footnote rows', () => {
    expect(rows.some((r) => r.destination.includes('enquiry'))).toBe(false);
  });

  it('handles sparse rows without crashing', () => {
    const sparse: unknown[][] = [
      ['POL', 'POD', "20'"],
      // eslint-disable-next-line no-sparse-arrays
      ['PKG', , 100], // hole in POD -> row skipped, no crash
      ['PKG', 'PENANG', 80],
    ];
    expect(extractRates(sparse)).toEqual([
      expect.objectContaining({ destination: 'PENANG', containerType: '20FT', cost: 80 }),
    ]);
  });

  it('returns empty when no POL/POD header exists', () => {
    expect(extractRates([['random'], ['content']])).toEqual([]);
  });

  it('auto-detects the sheet currency from any cell text', () => {
    expect(detectCurrency([['OCEAN FREIGHT (USD)'], ['POL', 'POD']])).toBe('USD');
    expect(detectCurrency([['no currency here']])).toBeUndefined();
  });
});

describe('parseRateSheet — server-side workbook parsing (exceljs round-trip)', () => {
  const service = new ImportsService(
    {} as never, // prisma unused by parseRateSheet
    {} as never, // sequence unused by parseRateSheet
    { log: jest.fn(async () => undefined) } as never,
  );

  async function workbookBuffer(grid: unknown[][]): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Rates');
    for (const row of grid) ws.addRow(row as unknown[]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const asFile = (buffer: Buffer, originalname = 'rates.xlsx') =>
    ({ buffer, originalname, size: buffer.length } as Express.Multer.File);

  it('parses a real .xlsx into the exact same rows as the grid logic (golden round-trip)', async () => {
    const buffer = await workbookBuffer(TCL_LIKE_GRID);
    const result = await service.parseRateSheet(asFile(buffer));
    expect(result.rows).toEqual(extractRates(TCL_LIKE_GRID));
    expect(result.rows).toHaveLength(8); // JAKARTA + CAT LAI ×2 sizes, CHITTAGONG ×2 sizes ×2 carriers
  });

  it('detects the currency and reports no warnings for a clean sheet', async () => {
    const buffer = await workbookBuffer([['RATES IN USD'], ...TCL_LIKE_GRID]);
    const result = await service.parseRateSheet(asFile(buffer));
    expect(result.currency).toBe('USD');
    expect(result.warnings).toEqual([]);
  });

  it('warns instead of failing when no rate table is found', async () => {
    const buffer = await workbookBuffer([['just'], ['text']]);
    const result = await service.parseRateSheet(asFile(buffer));
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((w) => w.includes('POL'))).toBe(true);
  });

  it('rejects a missing upload', async () => {
    await expect(service.parseRateSheet(undefined as never)).rejects.toThrow(BadRequestException);
  });

  it('rejects non-.xlsx filenames with a helpful message', async () => {
    const buffer = await workbookBuffer(TCL_LIKE_GRID);
    await expect(service.parseRateSheet(asFile(buffer, 'rates.xls'))).rejects.toThrow(/re-save .xls files as .xlsx/);
  });

  it('rejects a corrupt buffer that is not a workbook', async () => {
    await expect(service.parseRateSheet(asFile(Buffer.from('not an excel file')))).rejects.toThrow(/Could not read/);
  });
});
