/**
 * Quotation Costing Engine — pure functions, no I/O, fully unit-tested.
 *
 * Calibrated against real co-loader LCL tariffs (ECU Worldwide export
 * tariff, Solid Xpress/Globelink quotation):
 *  - W/M (weight-or-measure) chargeable units: max(CBM, KG / weightRatio),
 *    with vendor-specific ratios like 1 CBM : 333 KGS (see chargeableWM)
 *  - Negative ocean freight (co-loader rebates) flows through cost and GP;
 *    minimum charge only applies when the tariff publishes one
 *  - Markup always moves the sell price ABOVE cost (uses |cost| as the
 *    base), so a -45 rebate with 25% markup sells at -33.75, GP +11.25
 *
 * Flow per line item:
 *   1. Convert vendor cost to quotation currency via fxRate.
 *   2. rawCost = quantity × unitCost × fx
 *   3. totalCost = max(rawCost, minimumCharge × fx)   ← vendor minimum charge
 *   4. unitSell  = unitCost × fx × (1 + markup%)      (or taken as given when
 *      the user types a sell price directly; markup% is then back-computed)
 *   5. totalSell = max(quantity × unitSell, totalCost-scaled minimum)
 *
 * Quotation level:
 *   subtotal   = Σ totalSell
 *   discount   = subtotal × discount% + discountAmt
 *   serviceChg = (subtotal − discount) × serviceCharge%
 *   netSell    = subtotal − discount + serviceChg + miscCharge
 *   tax        = netSell × tax%
 *   grandTotal = netSell + tax
 *   GP         = netSell − totalCost        (profit measured before tax)
 *   GP%        = GP / netSell × 100
 */

export interface CostingItemInput {
  quantity: number;
  unitCost: number;          // in cost currency
  fxRate?: number;           // cost currency -> quotation currency (default 1)
  minimumCharge?: number | null; // in cost currency
  markupPct?: number;        // e.g. 25 for +25%
  unitSell?: number;         // in quotation currency; wins over markupPct when provided
}

export interface CostingItemResult {
  unitSell: number;
  markupPct: number;
  totalCost: number;
  totalSell: number;
  grossProfit: number;
  gpPercent: number;
}

export interface QuotationChargesInput {
  discountPct?: number;
  discountAmt?: number;
  serviceChargePct?: number;
  miscCharge?: number;
  taxPct?: number;
}

export interface QuotationTotals {
  totalCost: number;
  subtotalSell: number;
  discountAmt: number;
  serviceChargeAmt: number;
  miscCharge: number;
  netSell: number;
  taxAmt: number;
  sellingPrice: number; // grand total incl. tax
  grossProfit: number;
  gpPercent: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function computeItem(input: CostingItemInput): CostingItemResult {
  const qty = Number(input.quantity) || 0;
  const fx = Number(input.fxRate ?? 1) || 1;
  const unitCostQuote = (Number(input.unitCost) || 0) * fx;

  const rawCost = qty * unitCostQuote;
  // Minimum charge only when the tariff publishes one — max(raw, 0) would
  // otherwise silently erase negative (rebate) freight.
  const hasMin = input.minimumCharge != null;
  const minCharge = hasMin ? Number(input.minimumCharge) * fx : 0;
  const totalCost = r2(hasMin ? Math.max(rawCost, minCharge) : rawCost);

  let unitSell: number;
  let markupPct: number;
  if (input.unitSell != null && input.unitSell !== 0) {
    unitSell = Number(input.unitSell);
    markupPct = unitCostQuote !== 0 ? r4(((unitSell - unitCostQuote) / Math.abs(unitCostQuote)) * 100) : 0;
  } else {
    markupPct = Number(input.markupPct ?? 0);
    // Base the markup on |cost| so sell is always ABOVE cost, even for rebates.
    unitSell = r4(unitCostQuote + Math.abs(unitCostQuote) * (markupPct / 100));
  }

  // If the vendor minimum kicked in on cost, scale the sell floor the same way
  // so a tiny shipment never sells below marked-up minimum.
  const rawSell = qty * unitSell;
  const minSell = hasMin && minCharge > 0 && rawCost < minCharge ? minCharge * (1 + markupPct / 100) : 0;
  const totalSell = r2(Math.max(rawSell, minSell));

  const grossProfit = r2(totalSell - totalCost);
  const gpPercent = totalSell !== 0 ? r4((grossProfit / Math.abs(totalSell)) * 100) : 0;
  return { unitSell, markupPct, totalCost, totalSell, grossProfit, gpPercent };
}

export function computeQuotation(items: CostingItemResult[], charges: QuotationChargesInput = {}): QuotationTotals {
  const totalCost = r2(items.reduce((s, i) => s + i.totalCost, 0));
  const subtotalSell = r2(items.reduce((s, i) => s + i.totalSell, 0));

  const discountAmt = r2(subtotalSell * (Number(charges.discountPct ?? 0) / 100) + Number(charges.discountAmt ?? 0));
  const afterDiscount = subtotalSell - discountAmt;
  const serviceChargeAmt = r2(afterDiscount * (Number(charges.serviceChargePct ?? 0) / 100));
  const miscCharge = r2(Number(charges.miscCharge ?? 0));
  const netSell = r2(afterDiscount + serviceChargeAmt + miscCharge);
  const taxAmt = r2(netSell * (Number(charges.taxPct ?? 0) / 100));
  const sellingPrice = r2(netSell + taxAmt);

  const grossProfit = r2(netSell - totalCost);
  const gpPercent = netSell > 0 ? r4((grossProfit / netSell) * 100) : 0;

  return { totalCost, subtotalSell, discountAmt, serviceChargeAmt, miscCharge, netSell, taxAmt, sellingPrice, grossProfit, gpPercent };
}

// ─────────────────────────── LCL W/M helper ───────────────────────────

export interface WmInput {
  weightKg: number;
  volumeCbm: number;
  /** kg per CBM published by the co-loader, e.g. 333 for "1CBM:333KGS". Default 1000 (1 t = 1 CBM). */
  weightRatio?: number | null;
}

/**
 * Chargeable weight-or-measure units (in CBM-equivalents) for PER_WM rates:
 * whichever is greater of the cargo volume or its weight expressed in CBM
 * via the vendor's weight ratio.
 */
export function chargeableWM(input: WmInput): number {
  const ratio = input.weightRatio && input.weightRatio > 0 ? input.weightRatio : 1000;
  const byWeight = (Number(input.weightKg) || 0) / ratio;
  const byVolume = Number(input.volumeCbm) || 0;
  return Math.round(Math.max(byWeight, byVolume) * 1000) / 1000;
}
