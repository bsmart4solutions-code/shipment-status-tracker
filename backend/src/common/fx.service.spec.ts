import { FxService } from './fx.service';
import { PrismaService } from './prisma.service';

/** Minimal Prisma stub returning a fixed rate table for converter(). */
function fakePrisma(rates: { baseCurrency: string; quoteCurrency: string; rate: number; effectiveDate: Date }[]): PrismaService {
  return {
    exchangeRate: { findMany: jest.fn().mockResolvedValue(rates) },
  } as unknown as PrismaService;
}

const D = (s: string) => new Date(s);

describe('FxService', () => {
  const OLD_ENV = process.env.BASE_CURRENCY;
  beforeAll(() => { process.env.BASE_CURRENCY = 'MYR'; });
  afterAll(() => { process.env.BASE_CURRENCY = OLD_ENV; });

  it('returns amounts unchanged when already in base currency', async () => {
    const fx = new FxService(fakePrisma([]));
    const c = await fx.converter();
    expect(c.toBase(1000, 'MYR')).toBe(1000);
    expect(c.toBase(1000, null)).toBe(1000);
    expect(c.missing.size).toBe(0);
  });

  it('converts a foreign currency via a direct rate', async () => {
    const fx = new FxService(fakePrisma([
      { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.45, effectiveDate: D('2026-01-01') },
    ]));
    const c = await fx.converter();
    expect(c.toBase(1000, 'USD')).toBe(4450);
    expect(c.missing.size).toBe(0);
  });

  it('converts via an inverse rate when only base→foreign is configured', async () => {
    const fx = new FxService(fakePrisma([
      { baseCurrency: 'MYR', quoteCurrency: 'USD', rate: 0.2, effectiveDate: D('2026-01-01') },
    ]));
    const c = await fx.converter();
    // 1 USD = 1 / 0.2 = 5 MYR
    expect(c.toBase(100, 'USD')).toBe(500);
  });

  it('uses the latest effectiveDate when multiple rates exist for a pair', async () => {
    const fx = new FxService(fakePrisma([
      { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.0, effectiveDate: D('2026-01-01') },
      { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.6, effectiveDate: D('2026-06-01') },
    ]));
    const c = await fx.converter();
    // toBase is intentionally unrounded (callers round the final sum), so
    // assert with tolerance rather than exact float equality.
    expect(c.toBase(100, 'USD')).toBeCloseTo(460, 6);
  });

  it('flags a missing rate and falls back 1:1 with a warning', async () => {
    const fx = new FxService(fakePrisma([]));
    const c = await fx.converter();
    expect(c.toBase(1000, 'JPY')).toBe(1000);
    expect(c.missing.has('JPY')).toBe(true);
    expect(fx.warning(c)).toMatch(/JPY/);
    expect(fx.warning(c)).toMatch(/unreliable/);
  });

  it('returns no warning when every currency resolved', async () => {
    const fx = new FxService(fakePrisma([
      { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.45, effectiveDate: D('2026-01-01') },
    ]));
    const c = await fx.converter();
    c.toBase(1, 'USD');
    c.toBase(1, 'MYR');
    expect(fx.warning(c)).toBeNull();
  });
});
