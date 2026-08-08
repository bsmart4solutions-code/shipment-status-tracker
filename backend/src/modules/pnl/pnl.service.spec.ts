import { FxService } from '../../common/fx.service';
import { PnlService } from './pnl.service';

/**
 * The defect this file exists for: the P&L converted with the LATEST rate, so
 * adding one rate today silently re-valued every past period. A March margin
 * quoted to the accountant in April did not match the same March margin run in
 * August — with no edit to any document explaining the difference.
 *
 * The central assertion is therefore not "the arithmetic is right" but "the
 * answer does not change when a newer rate is added". FxService is real, not
 * stubbed: the rate-resolution rule is exactly what is under test, so a stub
 * could only prove the stub.
 */

const BASE = 'MYR';

/** Real FxService over a fake exchange_rates table. */
function fxWith(rates: { baseCurrency: string; quoteCurrency: string; rate: number; effectiveDate: string }[]) {
  const prisma = {
    exchangeRate: {
      findMany: jest.fn(async () =>
        rates
          .map((r) => ({ ...r, effectiveDate: new Date(r.effectiveDate) }))
          .sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime()),
      ),
    },
  };
  return new FxService(prisma as never);
}

type Quote = {
  quoteDate: string; currency: string; sellingPrice: number; taxAmt: number; totalCost: number;
};

function serviceWith(quotes: Quote[], fx: FxService) {
  const prisma = {
    quotation: {
      findMany: jest.fn(async () =>
        quotes.map((q) => ({
          ...q,
          quoteDate: new Date(q.quoteDate),
          customer: { companyName: 'Acme Sdn Bhd' },
          salesPerson: { fullName: 'Sarah' },
        })),
      ),
    },
    quotationItem: { findMany: jest.fn(async () => []) },
    job: { findMany: jest.fn(async () => []) },
  };
  return new PnlService(prisma as never, fx);
}

// One USD quote in March, one in August.
const QUOTES: Quote[] = [
  { quoteDate: '2026-03-15', currency: 'USD', sellingPrice: 1000, taxAmt: 0, totalCost: 600 },
  { quoteDate: '2026-08-15', currency: 'USD', sellingPrice: 1000, taxAmt: 0, totalCost: 600 },
];

const MARCH_RATE = { baseCurrency: 'USD', quoteCurrency: BASE, rate: 4.2, effectiveDate: '2026-01-01' };
const AUGUST_RATE = { baseCurrency: 'USD', quoteCurrency: BASE, rate: 4.7, effectiveDate: '2026-08-01' };

describe('PnlService — historical stability', () => {
  beforeEach(() => { process.env.BASE_CURRENCY = BASE; });

  it('values each period at the rate in effect then, not the newest rate', async () => {
    const service = serviceWith(QUOTES, fxWith([MARCH_RATE, AUGUST_RATE]));

    const report = await service.report({ groupBy: 'month' });
    const march = report.rows.find((r) => r.group === '2026-03')!;
    const august = report.rows.find((r) => r.group === '2026-08')!;

    // March predates the August rate, so it must still use 4.2.
    expect(march.revenue).toBe(4200);   // 1000 × 4.2
    expect(march.cost).toBe(2520);      //  600 × 4.2
    expect(august.revenue).toBe(4700);  // 1000 × 4.7
    expect(august.cost).toBe(2820);     //  600 × 4.7
  });

  it('THE REGRESSION: back-filling a rate does not move a past period', async () => {
    // Run the report before the August rate exists…
    const before = await serviceWith(QUOTES, fxWith([MARCH_RATE])).report({ groupBy: 'month' });
    const marchBefore = before.rows.find((r) => r.group === '2026-03')!;

    // …then a rate is entered for August and the SAME report is run again.
    const after = await serviceWith(QUOTES, fxWith([MARCH_RATE, AUGUST_RATE])).report({ groupBy: 'month' });
    const marchAfter = after.rows.find((r) => r.group === '2026-03')!;

    // March is closed. Nothing about it may change.
    expect(marchAfter).toEqual(marchBefore);
    expect(marchAfter.grossProfit).toBe(1680); // (1000 − 600) × 4.2
  });

  it('reprices only the period the new rate actually applies to', async () => {
    const before = await serviceWith(QUOTES, fxWith([MARCH_RATE])).report({ groupBy: 'month' });
    const after = await serviceWith(QUOTES, fxWith([MARCH_RATE, AUGUST_RATE])).report({ groupBy: 'month' });

    const augBefore = before.rows.find((r) => r.group === '2026-08')!;
    const augAfter = after.rows.find((r) => r.group === '2026-08')!;

    // August had been valued at the older 4.2 because nothing better existed;
    // once its own rate is entered it correctly moves to 4.7.
    expect(augBefore.revenue).toBe(4200);
    expect(augAfter.revenue).toBe(4700);
  });

  it('a quote dated before ANY rate is flagged rather than quietly converted', async () => {
    const service = serviceWith(
      [{ quoteDate: '2025-06-01', currency: 'USD', sellingPrice: 1000, taxAmt: 0, totalCost: 600 }],
      fxWith([MARCH_RATE]), // effective 2026-01-01 — after the document
    );

    const report = await service.report({ groupBy: 'month' });

    // Included 1:1, but the caller is told so rather than being shown an
    // unconverted figure dressed up as a converted one.
    expect(report.fxIncomplete).toBe(true);
    expect(report.fxWarning).toMatch(/USD/);
    expect(report.rows[0].revenue).toBe(1000);
  });

  it('reports no FX warning when every document resolves', async () => {
    const report = await serviceWith(QUOTES, fxWith([MARCH_RATE, AUGUST_RATE])).report({ groupBy: 'month' });

    expect(report.fxIncomplete).toBe(false);
    expect(report.fxWarning).toBeNull();
    expect(report.baseCurrency).toBe(BASE);
  });

  it('base-currency documents are unaffected by rates entirely', async () => {
    const service = serviceWith(
      [{ quoteDate: '2026-03-15', currency: BASE, sellingPrice: 1000, taxAmt: 60, totalCost: 600 }],
      fxWith([]), // no rates configured at all
    );

    const report = await service.report({ groupBy: 'month' });

    expect(report.fxIncomplete).toBe(false);
    expect(report.rows[0].revenue).toBe(940); // net of tax, no conversion
    expect(report.rows[0].cost).toBe(600);
  });

  it('groups by customer without losing per-document date valuation', async () => {
    // Both quotes land in one bucket, but each must still use its own date's
    // rate — otherwise a non-period grouping would reintroduce the defect.
    const service = serviceWith(QUOTES, fxWith([MARCH_RATE, AUGUST_RATE]));

    const report = await service.report({ groupBy: 'customer' });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].group).toBe('Acme Sdn Bhd');
    expect(report.rows[0].revenue).toBe(8900); // 4200 + 4700, not 2 × either
  });
});
