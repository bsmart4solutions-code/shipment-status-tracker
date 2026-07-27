import { computeItem, computeQuotation, chargeableWM } from './costing.engine';

describe('Costing engine — items', () => {
  it('applies markup to unit cost', () => {
    const r = computeItem({ quantity: 500, unitCost: 2.8, markupPct: 25 });
    expect(r.unitSell).toBe(3.5);
    expect(r.totalCost).toBe(1400);
    expect(r.totalSell).toBe(1750);
    expect(r.grossProfit).toBe(350);
    expect(r.gpPercent).toBe(20);
  });

  it('enforces vendor minimum charge on cost and sell', () => {
    // 10kg × 2.80 = 28 < min 180 → cost floors at 180, sell at 180×1.25
    const r = computeItem({ quantity: 10, unitCost: 2.8, minimumCharge: 180, markupPct: 25 });
    expect(r.totalCost).toBe(180);
    expect(r.totalSell).toBe(225);
    expect(r.grossProfit).toBe(45);
  });

  it('converts foreign currency cost via fx rate', () => {
    // 100kg × USD 1.20 × 4.45 = MYR 534 cost; +20% sell
    const r = computeItem({ quantity: 100, unitCost: 1.2, fxRate: 4.45, markupPct: 20 });
    expect(r.totalCost).toBe(534);
    expect(r.totalSell).toBe(640.8);
    expect(r.gpPercent).toBeCloseTo(16.6667, 3);
  });

  it('back-computes markup when sell price given directly', () => {
    const r = computeItem({ quantity: 1, unitCost: 140, unitSell: 230 });
    expect(r.markupPct).toBeCloseTo(64.2857, 3);
    expect(r.grossProfit).toBe(90);
  });

  it('handles zero quantity safely', () => {
    const r = computeItem({ quantity: 0, unitCost: 100, markupPct: 10 });
    expect(r.totalCost).toBe(0);
    expect(r.totalSell).toBe(0);
    expect(r.gpPercent).toBe(0);
  });
});

describe('Costing engine — quotation totals', () => {
  const items = [
    computeItem({ quantity: 500, unitCost: 2.8, markupPct: 25 }), // cost 1400 sell 1750
    computeItem({ quantity: 1, unitCost: 140, unitSell: 230 }),   // cost 140 sell 230
  ];

  it('aggregates subtotal, GP and GP%', () => {
    const t = computeQuotation(items);
    expect(t.totalCost).toBe(1540);
    expect(t.subtotalSell).toBe(1980);
    expect(t.grossProfit).toBe(440);
    expect(t.gpPercent).toBeCloseTo(22.2222, 3);
  });

  it('applies discount %, service charge %, misc and tax in order', () => {
    const t = computeQuotation(items, { discountPct: 5, serviceChargePct: 2, miscCharge: 50, taxPct: 8 });
    // 1980 − 99 = 1881; +2% = 1918.62; +50 = 1968.62; tax 157.49; total 2126.11
    expect(t.discountAmt).toBe(99);
    expect(t.serviceChargeAmt).toBe(37.62);
    expect(t.netSell).toBe(1968.62);
    expect(t.taxAmt).toBe(157.49);
    expect(t.sellingPrice).toBe(2126.11);
    // GP measured before tax: 1968.62 − 1540 = 428.62
    expect(t.grossProfit).toBe(428.62);
    expect(t.gpPercent).toBeCloseTo(21.77, 1);
  });

  it('supports flat discount amount', () => {
    const t = computeQuotation(items, { discountAmt: 100 });
    expect(t.netSell).toBe(1880);
    expect(t.grossProfit).toBe(340);
  });

  it('never divides by zero on empty quote', () => {
    const t = computeQuotation([], { taxPct: 8 });
    expect(t.sellingPrice).toBe(0);
    expect(t.gpPercent).toBe(0);
  });
});

describe('Costing engine — LCL rebates & W/M', () => {
  it('preserves negative freight (rebate) rates in cost', () => {
    // ECU rebate: -45 cost on 1 CBM → should stay -45, not reset to 0
    const r = computeItem({ quantity: 1, unitCost: -45, markupPct: 25 });
    expect(r.totalCost).toBe(-45);
    expect(r.unitSell).toBe(-33.75);
    expect(r.grossProfit).toBe(11.25);
  });

  it('applies markup to rebate cost using absolute value', () => {
    // -45 rebate + 25% markup = -45 + |−45| × 0.25 = -45 + 11.25 = -33.75 sell ✓
    const r = computeItem({ quantity: 2, unitCost: -45, markupPct: 25 });
    expect(r.unitSell).toBe(-33.75);
    expect(r.totalSell).toBe(-67.5);
    expect(r.grossProfit).toBe(r.totalSell - r.totalCost);
    expect(r.grossProfit).toBe(22.5);
  });

  it('calculates meaningful GP% on rebate lines using absolute sell value', () => {
    // -45 cost, -33.75 sell, +11.25 GP; GP% = 11.25 / |−33.75| × 100 = 33.33%
    const r = computeItem({ quantity: 1, unitCost: -45, markupPct: 25 });
    expect(r.gpPercent).toBeCloseTo(33.33, 1);
  });

  it('does not apply minimum charge when tariff does not publish one', () => {
    // No minimumCharge specified → rawCost -45 should be preserved
    const r = computeItem({ quantity: 1, unitCost: -45, minimumCharge: undefined, markupPct: 25 });
    expect(r.totalCost).toBe(-45);
  });

  it('applies minimum charge only when explicitly provided', () => {
    // Small qty × high rate < minimum → cost floors at minimum
    const r = computeItem({ quantity: 0.5, unitCost: 100, minimumCharge: 50, markupPct: 20 });
    expect(r.totalCost).toBe(50);
    expect(r.totalSell).toBe(60);
  });

  it('back-computes markup on rebate cost as percentage of absolute value', () => {
    // Cost -100, sell -75 → markup on |−100| = (-75 − (−100)) / 100 = 25%
    const r = computeItem({ quantity: 1, unitCost: -100, unitSell: -75 });
    expect(r.markupPct).toBe(25);
  });

  it('calculates chargeable W/M for LCL using weight and volume', () => {
    // By volume: 5 CBM
    // By weight: 2000 kg / 333 kg-per-CBM = 6.006 CBM
    // Chargeable = max(5, 6.006) = 6.006 CBM
    const wm = chargeableWM({ weightKg: 2000, volumeCbm: 5, weightRatio: 333 });
    expect(wm).toBeCloseTo(6.006, 2);
  });

  it('defaults weight ratio to 1000 kg/CBM when not specified', () => {
    // By volume: 2 CBM
    // By weight: 2000 kg / 1000 = 2 CBM
    // Chargeable = max(2, 2) = 2 CBM
    const wm = chargeableWM({ weightKg: 2000, volumeCbm: 2 });
    expect(wm).toBe(2);
  });

  it('volume-heavy shipment uses volume as chargeable W/M', () => {
    // By volume: 10 CBM
    // By weight: 1000 kg / 333 = 3.003 CBM
    // Chargeable = max(10, 3.003) = 10 CBM
    const wm = chargeableWM({ weightKg: 1000, volumeCbm: 10, weightRatio: 333 });
    expect(wm).toBe(10);
  });

  it('weight-heavy shipment uses weight-derived units as chargeable W/M', () => {
    // By volume: 2 CBM
    // By weight: 2000 kg / 333 = 6.006 CBM
    // Chargeable = max(2, 6.006) = 6.006 CBM
    const wm = chargeableWM({ weightKg: 2000, volumeCbm: 2, weightRatio: 333 });
    expect(wm).toBeCloseTo(6.006, 2);
  });

  it('handles zero shipment gracefully', () => {
    const wm = chargeableWM({ weightKg: 0, volumeCbm: 0 });
    expect(wm).toBe(0);
  });
});
