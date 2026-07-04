import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface FxConverter {
  /** Convert an amount from `currency` into the base currency using the latest rate. */
  toBase: (amount: number, currency: string | null | undefined) => number;
  /** Currencies encountered with no configured rate (included 1:1, must be surfaced to the caller). */
  missing: Set<string>;
  baseCurrency: string;
}

/**
 * Currency conversion for report aggregation. Documents (quotations, jobs,
 * invoices) each carry their own currency, so any SUM across records MUST
 * convert to one base currency first — adding 10,000 MYR to 10,000 USD as
 * "20,000" silently misstates every dashboard/P&L figure.
 *
 * Rates are loaded once per converter (the table is small) and resolved
 * direct (CUR->base) or inverse (base->CUR). A missing rate falls back to
 * 1:1 but is recorded in `missing` so the API response can warn instead of
 * failing the whole dashboard.
 */
@Injectable()
export class FxService {
  constructor(private prisma: PrismaService) {}

  baseCurrency(): string {
    return process.env.BASE_CURRENCY || 'MYR';
  }

  async converter(): Promise<FxConverter> {
    // Ascending order so later effectiveDates overwrite earlier ones — the
    // map ends up holding the latest rate for each pair.
    const rates = await this.prisma.exchangeRate.findMany({ orderBy: { effectiveDate: 'asc' } });
    const latest = new Map<string, number>();
    for (const r of rates) latest.set(`${r.baseCurrency}->${r.quoteCurrency}`, Number(r.rate));

    const base = this.baseCurrency();
    const missing = new Set<string>();
    const toBase = (amount: number, currency: string | null | undefined): number => {
      if (!currency || currency === base) return amount;
      const direct = latest.get(`${currency}->${base}`);
      if (direct !== undefined) return amount * direct;
      const inverse = latest.get(`${base}->${currency}`);
      if (inverse !== undefined && inverse !== 0) return amount / inverse;
      missing.add(currency);
      return amount;
    };
    return { toBase, missing, baseCurrency: base };
  }

  /** Human-readable warning when rates were missing, else null. */
  warning(c: FxConverter): string | null {
    if (c.missing.size === 0) return null;
    return `No exchange rate configured to ${c.baseCurrency} for: ${[...c.missing].sort().join(', ')} — those amounts were included 1:1 and totals are unreliable until rates are added`;
  }
}
