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
