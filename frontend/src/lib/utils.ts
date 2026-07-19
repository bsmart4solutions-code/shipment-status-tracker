import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtMoney = (v: number | string | null | undefined, currency = 'MYR') =>
  `${currency} ${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : '-';

export const fmtPct = (v: number | string | null | undefined) => `${Number(v ?? 0).toFixed(1)}%`;

/**
 * Amount in words for the printed tax invoice, e.g.
 * "Thirteen Thousand Two Hundred Fifty Eight And Ninety Eight Cents Only".
 * Handles the integer part up to billions plus a 2-decimal cents remainder.
 */
export function amountInWords(value: number | string): string {
  const n = Math.abs(Number(value ?? 0));
  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);

  const ones = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const under1000 = (x: number): string => {
    let s = '';
    if (x >= 100) { s += ones[Math.floor(x / 100)] + ' Hundred'; x %= 100; if (x) s += ' '; }
    if (x >= 20) { s += tens[Math.floor(x / 10)]; x %= 10; if (x) s += ' ' + ones[x]; }
    else if (x > 0) { s += ones[x]; }
    return s;
  };

  const scales = [
    { v: 1_000_000_000, name: 'Billion' },
    { v: 1_000_000, name: 'Million' },
    { v: 1_000, name: 'Thousand' },
  ];
  let words = '';
  let rest = dollars;
  for (const { v, name } of scales) {
    if (rest >= v) {
      words += under1000(Math.floor(rest / v)) + ' ' + name + ' ';
      rest %= v;
    }
  }
  if (rest > 0 || words === '') words += under1000(rest);
  words = words.trim();

  if (cents > 0) words += ` And ${under1000(cents)} Cents`;
  return words + ' Only';
}
