import { FxService } from './fx.service';

/**
 * Sprint 03A / H-2 — the historical converter resolves the rate in effect on a
 * given date, so a figure computed from a document's own date stays stable when
 * newer rates are added later.
 */
function makeFx(rates: { baseCurrency: string; quoteCurrency: string; rate: number; effectiveDate: string }[]) {
  const prisma = {
    exchangeRate: {
      findMany: jest.fn(async () => rates
        .map((r) => ({ ...r, effectiveDate: new Date(r.effectiveDate) }))
        .sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime())),
    },
  };
  return new FxService(prisma as never);
}

const d = (s: string) => new Date(s);

describe('FxService.historicalConverter — bill-date resolution', () => {
  const rates = [
    { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.0, effectiveDate: '2026-01-01' },
    { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.5, effectiveDate: '2026-06-01' },
    { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 5.0, effectiveDate: '2026-12-01' },
  ];

  it('uses the rate in effect on the supplied date, not the latest one', async () => {
    const fx = await makeFx(rates).historicalConverter();
    expect(fx.toBaseAt(100, 'USD', d('2026-03-15'))).toBe(400); // Jan rate
    expect(fx.toBaseAt(100, 'USD', d('2026-07-15'))).toBe(450); // Jun rate
    expect(fx.toBaseAt(100, 'USD', d('2026-12-31'))).toBe(500); // Dec rate
  });

  it('keeps a historical figure stable when a newer rate is added', async () => {
    const before = await makeFx(rates.slice(0, 2)).historicalConverter();
    const after = await makeFx(rates).historicalConverter(); // Dec rate added
    const on = d('2026-07-15');
    expect(after.toBaseAt(100, 'USD', on)).toBe(before.toBaseAt(100, 'USD', on));
  });

  it('uses the rate effective exactly on the boundary date', async () => {
    const fx = await makeFx(rates).historicalConverter();
    expect(fx.toBaseAt(100, 'USD', d('2026-06-01'))).toBe(450);
  });

  it('converts the base currency 1:1 without recording a missing rate', async () => {
    const fx = await makeFx(rates).historicalConverter();
    expect(fx.toBaseAt(100, 'MYR', d('2026-07-15'))).toBe(100);
    expect(fx.missing.size).toBe(0);
  });

  it('resolves an inverse pair when only base->currency is configured', async () => {
    const fx = await makeFx([{ baseCurrency: 'MYR', quoteCurrency: 'SGD', rate: 0.5, effectiveDate: '2026-01-01' }])
      .historicalConverter();
    expect(fx.toBaseAt(100, 'SGD', d('2026-07-15'))).toBe(200); // 100 / 0.5
  });

  it('records a currency with NO configured rate instead of converting silently', async () => {
    const fx = await makeFx(rates).historicalConverter();
    fx.toBaseAt(100, 'EUR', d('2026-07-15'));
    expect([...fx.missing]).toEqual(['EUR']);
  });

  it('records a rate that does not yet exist at the requested date', async () => {
    const fx = await makeFx(rates).historicalConverter();
    // The earliest USD rate starts 2026-01-01; a 2025 bill has none.
    fx.toBaseAt(100, 'USD', d('2025-06-01'));
    expect([...fx.missing]).toEqual(['USD']);
  });

  it('feeds the SAME warning mechanism the latest-rate converter uses', async () => {
    const svc = makeFx(rates);
    const fx = await svc.historicalConverter();
    expect(svc.warning(fx)).toBeNull();
    fx.toBaseAt(100, 'EUR', d('2026-07-15'));
    expect(svc.warning(fx)).toMatch(/No exchange rate configured to MYR for: EUR/);
  });
});
