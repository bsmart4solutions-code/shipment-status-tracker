'use client';

import { useEffect, useRef, useState } from 'react';
import { Columns3 } from 'lucide-react';

/**
 * Column visibility for list tables, persisted per page in localStorage.
 * `all` is the full ordered column list; the returned `visible` preserves
 * that order. Pages render header cells and row cells conditionally via
 * `show(name)`.
 */
export function useColumns(pageKey: string, all: string[]) {
  const storageKey = `erp_cols_${pageKey}`;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch { /* corrupted state -> defaults */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const toggle = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (all.length - next.size > 1) next.add(name); // never hide the last column
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };

  const show = (name: string) => !hidden.has(name);
  const visible = all.filter(show);
  return { loaded, all, hidden, visible, show, toggle };
}

export function ColumnPicker({ columns }: { columns: ReturnType<typeof useColumns> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-ghost" onClick={() => setOpen((o) => !o)} title="Show / hide columns">
        <Columns3 size={15} /> Columns
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 card p-2 shadow-lg min-w-[180px] max-h-72 overflow-y-auto">
          {columns.all.filter(Boolean).map((c) => (
            <label key={c} className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              <input type="checkbox" checked={columns.show(c)} onChange={() => columns.toggle(c)} />
              {c}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
