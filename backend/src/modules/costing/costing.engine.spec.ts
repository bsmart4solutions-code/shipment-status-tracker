import { computeItem, computeQuotation } from './costing.engine';

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
