import { describe, expect, it } from 'vitest';
import { extractRates } from './rate-import-dialog';

// Grid shaped like the real TCL ocean FCL sheet: letterhead rows, a POL/POD
// header with 20'/40' columns, data rows (including same-lane carrier
// alternates with a trailing carrier note), and a prose footnote.
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

describe('extractRates — ocean FCL sheet parsing', () => {
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

  it('handles sparse rows (SheetJS emits holes) without crashing', () => {
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
});
