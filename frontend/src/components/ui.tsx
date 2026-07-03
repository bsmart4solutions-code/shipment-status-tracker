'use client';

/** Small shared UI primitives (shadcn-style, hand-rolled to stay dependency-light). */
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

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

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={cn('card w-full max-h-[92vh] overflow-y-auto', wide ? 'max-w-4xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
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
