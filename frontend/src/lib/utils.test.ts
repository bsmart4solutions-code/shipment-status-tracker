import { describe, expect, it } from 'vitest';
import { fmtDate, fmtMoney, fmtPct } from './utils';

describe('fmtMoney', () => {
  it('formats with currency prefix and 2 decimals', () => {
    expect(fmtMoney(1234.5, 'USD')).toBe('USD 1,234.50');
  });
  it('defaults to MYR and handles null/undefined as zero', () => {
    expect(fmtMoney(null)).toBe('MYR 0.00');
    expect(fmtMoney(undefined)).toBe('MYR 0.00');
  });
  it('accepts numeric strings (Prisma Decimal serialisation)', () => {
    expect(fmtMoney('1080.00', 'MYR')).toBe('MYR 1,080.00');
  });
});

describe('fmtDate', () => {
  it('renders ISO date part', () => {
    expect(fmtDate('2026-07-05T13:45:00.000Z')).toBe('2026-07-05');
  });
  it('renders a dash for missing values', () => {
    expect(fmtDate(null)).toBe('-');
    expect(fmtDate(undefined)).toBe('-');
  });
});

describe('fmtPct', () => {
  it('renders one decimal with % sign', () => {
    expect(fmtPct(21.75)).toBe('21.8%');
    expect(fmtPct('8')).toBe('8.0%');
    expect(fmtPct(null)).toBe('0.0%');
  });
});
