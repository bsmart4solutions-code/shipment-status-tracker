'use client';

/**
 * Vendor bill builder. Reuses the invoice/note line-item pattern and the
 * SVE-aware live totals. Lines may each carry their own job allocation, which
 * overrides the bill-level job — that is how one consolidated carrier invoice
 * covers several shipments.
 *
 * SST here is a COST, never recoverable input tax, so the totals block simply
 * adds it to what is owed.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Card, ErrorText, Modal, SearchableSelect } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/utils';
import type { BillRow } from './page';

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];
const UOM = ['SHPT', 'CONT', 'SET', "20'GP", "40'HC", 'M3', 'KG', 'TON', 'TRIP', 'UNIT', 'DAY'];

interface Line {
  description: string; unitPrice: number; unit: string; quantity: number;
  lineCurrency: string; fxRate: number; taxExempt: boolean; accNo: string; jobId: string;
}
const emptyLine = (ccy: string): Line => ({
  description: '', unitPrice: 0, unit: '', quantity: 1, lineCurrency: ccy, fxRate: 1,
  taxExempt: false, accNo: '', jobId: '',
});

interface BillDetail {
  id: string; vendorId: string; vendorInvoiceNo: string; jobId: string | null; currency: string;
  taxPct: string; billDate: string; dueDate: string | null; terms: string | null; notes: string | null;
  items: {
    description: string; unitPrice: string; unit: string | null; quantity: string; lineCurrency: string;
    fxRate: string; taxExempt: boolean; accNo: string | null; jobId: string | null;
  }[];
}

export function BillForm({ bill, onClose }: { bill: BillRow | null; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: detail } = useQuery({
    queryKey: ['payable-full', bill?.id],
    queryFn: () => api<BillDetail>(`/payables/${bill!.id}`),
    enabled: !!bill,
  });
  const { data: vendors } = useQuery({
    queryKey: ['vendors-all'],
    queryFn: () => api<{ items: { id: string; name: string; currency: string | null; paymentTerm: string | null }[] }>('/vendors?pageSize=200'),
  });
  const { data: jobs } = useQuery({
    queryKey: ['jobs-all'],
    queryFn: () => api<{ items: { id: string; jobNumber: string; customer: { companyName: string } }[] }>('/jobs?pageSize=200'),
  });

  const [vendorId, setVendorId] = useState('');
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('');
  const [jobId, setJobId] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [taxPct, setTaxPct] = useState(0);
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Line[]>([emptyLine('MYR')]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!bill || !detail || hydrated) return;
    setVendorId(detail.vendorId);
    setVendorInvoiceNo(detail.vendorInvoiceNo);
    setJobId(detail.jobId ?? '');
    setCurrency(detail.currency);
    setTaxPct(Number(detail.taxPct));
    setBillDate(String(detail.billDate).slice(0, 10));
    setDueDate(detail.dueDate ? String(detail.dueDate).slice(0, 10) : '');
    setTerms(detail.terms ?? '');
    setNotes(detail.notes ?? '');
    setItems(detail.items.length
      ? detail.items.map((i) => ({
          description: i.description, unitPrice: Number(i.unitPrice), unit: i.unit ?? '',
          quantity: Number(i.quantity), lineCurrency: i.lineCurrency, fxRate: Number(i.fxRate),
          taxExempt: i.taxExempt, accNo: i.accNo ?? '', jobId: i.jobId ?? '',
        }))
      : [emptyLine(detail.currency)]);
    setHydrated(true);
  }, [bill, detail, hydrated]);

  const setItem = (i: number, patch: Partial<Line>) =>
    setItems((p) => p.map((it, x) => (x === i ? { ...it, ...patch } : it)));

  // Adopt the vendor's currency and payment terms when one is picked.
  const onPickVendor = (id: string) => {
    setVendorId(id);
    const v = vendors?.items.find((x) => x.id === id);
    if (v) {
      if (v.currency) setCurrency(v.currency);
      if (v.paymentTerm && !terms) setTerms(v.paymentTerm);
    }
  };

  const totals = useMemo(() => {
    let subtotal = 0, taxable = 0;
    const lines = items.map((it) => {
      const amount = Math.round(it.quantity * it.unitPrice * (it.fxRate || 1) * 100) / 100;
      subtotal += amount;
      if (!it.taxExempt) taxable += amount;
      return amount;
    });
    const taxAmt = Math.round(taxable * (taxPct / 100) * 100) / 100;
    return { lines, subtotal, taxAmt, total: subtotal + taxAmt };
  }, [items, taxPct]);

  const hasItem = items.some((i) => i.description.trim());
  const needsVendor = !vendorId;
  const needsInvoiceNo = !vendorInvoiceNo.trim();

  const save = useMutation({
    mutationFn: () => {
      const body = {
        vendorId, vendorInvoiceNo, jobId: jobId || undefined, currency, taxPct,
        billDate: billDate || undefined, dueDate: dueDate || undefined,
        terms: terms || undefined, notes: notes || undefined,
        items: items.filter((i) => i.description.trim()).map((i) => ({
          description: i.description, unitPrice: i.unitPrice, unit: i.unit || undefined,
          quantity: i.quantity, lineCurrency: i.lineCurrency, fxRate: i.fxRate,
          taxExempt: i.taxExempt, accNo: i.accNo || undefined, jobId: i.jobId || undefined,
        })),
      };
      return bill
        ? api(`/payables/${bill.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/payables', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); onClose(); },
  });

  const jobOptions = (jobs?.items ?? []).map((j) => ({
    value: j.id, label: j.jobNumber, sublabel: j.customer?.companyName,
  }));

  return (
    <Modal title={bill ? `Edit ${bill.billNumber}` : 'New Vendor Bill'} onClose={onClose} size="xl">
      <div className="space-y-4">
        <Card className="!p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label">Vendor <span className="text-red-500">*</span></label>
              <SearchableSelect value={vendorId} onChange={onPickVendor} placeholder="Search vendor…"
                options={(vendors?.items ?? []).map((v) => ({ value: v.id, label: v.name }))} />
            </div>
            <div className="col-span-2">
              <label className="label">Vendor Invoice No <span className="text-red-500">*</span></label>
              <input className="input" placeholder="The number printed on their invoice"
                value={vendorInvoiceNo} onChange={(e) => setVendorInvoiceNo(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">Job <span className="text-gray-400 font-normal">(optional — lines can override)</span></label>
              <SearchableSelect value={jobId} onChange={setJobId} placeholder="Search job…" options={jobOptions} />
            </div>
            <div><label className="label">Currency</label>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div><label className="label">SST %</label>
              <input className="input" type="number" step="0.01" min="0" value={taxPct}
                onChange={(e) => setTaxPct(Number(e.target.value))} /></div>
            <div><label className="label">Bill Date</label>
              <input className="input" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
            <div><label className="label">Due Date</label>
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div className="col-span-2"><label className="label">Terms</label>
              <input className="input" placeholder="e.g. NET 30" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
          </div>
        </Card>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lines ({items.length})</div>
            <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs"
              onClick={() => setItems([...items, emptyLine(currency)])}><Plus size={13} /> Add Line</button>
          </div>
          <div className="space-y-3">
            {items.map((item, i) => (
              <Card key={i} className="!p-0 overflow-visible">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-800 rounded-t-xl">
                  <span className="text-xs font-semibold text-gray-500">Line {i + 1}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" title="SST-exempt line (SVE 0%)">
                      <input type="checkbox" checked={item.taxExempt}
                        onChange={(e) => setItem(i, { taxExempt: e.target.checked })} /> SST exempt
                    </label>
                    <button type="button" className="text-red-400 hover:text-red-600 disabled:opacity-30"
                      disabled={items.length === 1} onClick={() => setItems(items.filter((_, x) => x !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2">
                    <div><label className="label !text-xs">Description <span className="text-red-500">*</span></label>
                      <input className="input" value={item.description}
                        onChange={(e) => setItem(i, { description: e.target.value })} /></div>
                    <div><label className="label !text-xs">Job (overrides bill)</label>
                      <SearchableSelect value={item.jobId} onChange={(v) => setItem(i, { jobId: v })}
                        placeholder="Bill default" options={jobOptions} /></div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                    <div><label className="label !text-xs">Line Ccy</label>
                      <select className="input" value={item.lineCurrency}
                        onChange={(e) => setItem(i, { lineCurrency: e.target.value })}>
                        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                      </select></div>
                    <div><label className="label !text-xs">Unit Price</label>
                      <input className="input text-right" type="number" step="0.0001" min="0" value={item.unitPrice}
                        onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">UOM</label>
                      <input className="input" list="bill-uom" value={item.unit}
                        onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
                    <div><label className="label !text-xs">Qty</label>
                      <input className="input text-right" type="number" step="0.01" min="0.01" value={item.quantity}
                        onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">Ex. Rate</label>
                      <input className="input text-right" type="number" step="0.0001" min="0" value={item.fxRate}
                        onChange={(e) => setItem(i, { fxRate: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">Acc No</label>
                      <input className="input" value={item.accNo}
                        onChange={(e) => setItem(i, { accNo: e.target.value })} /></div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    Amount: <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtMoney(totals.lines[i] ?? 0, currency)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <datalist id="bill-uom">{UOM.map((u) => <option key={u} value={u} />)}</datalist>
        </div>

        <div><label className="label">Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <Card className="!bg-primary/5 dark:!bg-primary/10 !border-primary/20">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-gray-500">Subtotal</div>
              <div className="font-semibold">{fmtMoney(totals.subtotal, currency)}</div></div>
            <div><div className="text-xs text-gray-500">Service Tax (cost)</div>
              <div className="font-semibold">{fmtMoney(totals.taxAmt, currency)}</div></div>
            <div><div className="text-xs text-gray-500">Bill Total</div>
              <div className="text-lg font-bold text-primary">{fmtMoney(totals.total, currency)}</div></div>
          </div>
        </Card>

        <ErrorText error={save.error} />
        {(needsVendor || needsInvoiceNo || !hasItem) && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {needsVendor ? 'Select a vendor. ' : ''}
            {needsInvoiceNo ? "Enter the vendor's invoice number. " : ''}
            {!hasItem ? 'Add at least one line with a description.' : ''}
          </p>
        )}
        <button className="btn-primary w-full justify-center"
          disabled={needsVendor || needsInvoiceNo || !hasItem || save.isPending}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save Bill'}
        </button>
      </div>
    </Modal>
  );
}
