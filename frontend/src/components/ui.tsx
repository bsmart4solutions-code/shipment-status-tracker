'use client';

/** Small shared UI primitives (shadcn-style, hand-rolled to stay dependency-light). */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, X } from 'lucide-react';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('card p-4', className)}>{children}</div>;
}

export function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="card p-4">
      <div className={cn('text-2xl font-bold', accent ?? 'text-primary')}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SENT: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  WON: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  LOST: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  OPEN: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  IN_PROGRESS: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
  ON_HOLD: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  INACTIVE: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={cn('badge', STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT)}>{status.replace(/_/g, ' ')}</span>;
}

export function Modal({ title, onClose, children, wide, size }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; size?: 'xl' }) {
  const maxWidth = size === 'xl' ? 'max-w-6xl' : wide ? 'max-w-4xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={cn('card w-full max-h-[92vh] overflow-y-auto', maxWidth)} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-5 py-4 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800/60">
            <tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{children}</tbody>
        </table>
      </div>
      {empty && <p className="p-10 text-center text-gray-400 text-sm">No records found</p>}
    </div>
  );
}

export function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex justify-end items-center gap-2 text-sm text-gray-500">
      <button className="btn-ghost !py-1" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      <span>Page {page} / {pageCount}</span>
      <button className="btn-ghost !py-1" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600 mt-2">{error instanceof Error ? error.message : String(error)}</p>;
}

export function GpBadge({ pct }: { pct: number | string }) {
  const v = Number(pct);
  const color = v >= 20 ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
    : v >= 10 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  return <span className={cn('badge', color)}>{v.toFixed(1)}%</span>;
}

export interface SearchableOption { value: string; label: string; sublabel?: string }

/**
 * Type-to-filter dropdown for picking one record out of a list (customers,
 * vendors, services…) by ID. A plain <select> gets unusable once the list
 * grows past a couple dozen rows — this keeps the same value/onChange(id)
 * contract but filters options as you type and supports arrow-key nav.
 */
export function SearchableSelect({
  value, onChange, options, placeholder = 'Search…', disabled, allowClear = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
    : options;

  function pick(opt: SearchableOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="relative">
        <input
          className="input pr-8"
          placeholder={placeholder}
          disabled={disabled}
          value={open ? query : (selected?.label ?? '')}
          onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={onKeyDown}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {allowClear && selected && !open && (
            <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-600" onClick={() => onChange('')}>
              <X size={14} />
            </button>
          )}
          <ChevronDown size={14} className="text-gray-400 pointer-events-none" />
        </div>
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto card !shadow-lg py-1">
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No matches</div>}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              className={cn(
                'px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-2',
                i === highlight ? 'bg-primary/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800',
              )}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span className="truncate">
                {o.label}
                {o.sublabel && <span className="text-gray-400"> — {o.sublabel}</span>}
              </span>
              {o.value === value && <Check size={14} className="text-primary shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
