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
 * Date-aware converter for values that must stay historically stable — a
 * figure computed from a document's own date must not move when a newer rate
 * is added later. Shares `missing` and `baseCurrency` with FxConverter so
 * `FxService.warning()` applies unchanged.
 */
export interface HistoricalFxConverter {
  /** Convert into base using the rate effective on or before `on`. */
  toBaseAt: (amount: number, currency: string | null | undefined, on: Date) => number;
  /** True when any conversion could not be resolved (see `missing`). */
  readonly missing: Set<string>;
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

  /**
   * Converter that resolves each amount at a point in time (Sprint 03A / H-2).
   *
   * Reports that compare historical documents must not shift when a newer rate
   * is entered, so the rate chosen is the latest one whose `effectiveDate` is
   * on or before the supplied date. A currency with no qualifying rate is
   * recorded in `missing` and the amount is returned unconverted — callers MUST
   * surface `warning()` (and should suppress derived figures) rather than
   * presenting an unconverted total as if it were converted.
   */
  async historicalConverter(): Promise<HistoricalFxConverter> {
    // Ascending: for a given pair, the last entry at or before a date wins.
    const rates = await this.prisma.exchangeRate.findMany({ orderBy: { effectiveDate: 'asc' } });
    const series = new Map<string, { at: number; rate: number }[]>();
    for (const r of rates) {
      const key = `${r.baseCurrency}->${r.quoteCurrency}`;
      const list = series.get(key) ?? [];
      list.push({ at: r.effectiveDate.getTime(), rate: Number(r.rate) });
      series.set(key, list);
    }

    const base = this.baseCurrency();
    const missing = new Set<string>();
    const rateOn = (key: string, on: number): number | undefined => {
      const list = series.get(key);
      if (!list) return undefined;
      let found: number | undefined;
      for (const entry of list) {
        if (entry.at <= on) found = entry.rate;
        else break; // list is ascending — nothing later can qualify
      }
      return found;
    };

    const toBaseAt = (amount: number, currency: string | null | undefined, on: Date): number => {
      if (!currency || currency === base) return amount;
      const at = on.getTime();
      const direct = rateOn(`${currency}->${base}`, at);
      if (direct !== undefined) return amount * direct;
      const inverse = rateOn(`${base}->${currency}`, at);
      if (inverse !== undefined && inverse !== 0) return amount / inverse;
      missing.add(currency);
      return amount;
    };

    return { toBaseAt, missing, baseCurrency: base };
  }

  /**
   * Human-readable warning when rates were missing, else null. Typed on the
   * fields it actually reads so the same mechanism serves both the latest-rate
   * and the historical converter — there is one warning story, not two.
   */
  warning(c: Pick<FxConverter, 'missing' | 'baseCurrency'>): string | null {
    if (c.missing.size === 0) return null;
    return `No exchange rate configured to ${c.baseCurrency} for: ${[...c.missing].sort().join(', ')} — those amounts were included 1:1 and totals are unreliable until rates are added`;
  }
}
