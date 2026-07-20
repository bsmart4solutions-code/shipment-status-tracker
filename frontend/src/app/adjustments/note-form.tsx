'use client';

/**
 * Credit / Debit Note builder — reuses the invoice line-item pattern and the
 * SVE-aware live totals. A CREDIT note requires a source invoice; a DEBIT note
 * may be standalone (pick a customer). "Load lines from invoice" prefills the
 * items from the chosen invoice. DRAFT-only editing mirrors the invoice flow.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Card, ErrorText, Modal, SearchableSelect } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/utils';

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];
const UOM = ['SHPT', 'CONT', 'SET', "20'GP", "40'HC", 'M3', 'KG', 'TON', 'TRIP', 'UNIT', 'DAY'];

interface Line { description: string; unitPrice: number; unit: string; quantity: number; lineCurrency: string; fxRate: number; taxExempt: boolean; accNo: string }
const emptyLine = (ccy: string): Line => ({ description: '', unitPrice: 0, unit: '', quantity: 1, lineCurrency: ccy, fxRate: 1, taxExempt: false, accNo: '' });

interface InvoiceRow { id: string; invoiceNumber: string; currency: string; taxPct: string; customer: { companyName: string }; customerId: string }
interface NoteDetail {
  id: string; type: string; invoiceId: string | null; customerId: string; currency: string; taxPct: string;
  reason: string | null; issueDate: string; notes: string | null;
  items: { description: string; unitPrice: string; unit: string | null; quantity: string; lineCurrency: string; fxRate: string; taxExempt: boolean; accNo: string | null }[];
}

export function NoteModal({ type, note, initialInvoiceId, onClose }: {
  type: 'CREDIT' | 'DEBIT';
  note: { id: string; noteNumber: string } | null;
  /** Preselect the source invoice (e.g. when launched from the invoice list). */
  initialInvoiceId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const label = type === 'CREDIT' ? 'Credit Note' : 'Debit Note';

  const { data: detail } = useQuery({
    queryKey: ['note-full', note?.id],
    queryFn: () => api<NoteDetail>(`/credit-debit-notes/${note!.id}`),
    enabled: !!note,
  });
  const { data: invoices } = useQuery({ queryKey: ['invoices-all'], queryFn: () => api<{ items: InvoiceRow[] }>('/invoices?pageSize=200') });
  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api<{ items: { id: string; companyName: string }[] }>('/customers?pageSize=200') });

  const [invoiceId, setInvoiceId] = useState(initialInvoiceId ?? '');
  const [customerId, setCustomerId] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [taxPct, setTaxPct] = useState(6);
  const [reason, setReason] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Line[]>([emptyLine('MYR')]);
  const [hydrated, setHydrated] = useState(false);

  if (note && detail && !hydrated) {
    setInvoiceId(detail.invoiceId ?? '');
    setCustomerId(detail.customerId);
    setCurrency(detail.currency);
    setTaxPct(Number(detail.taxPct));
    setReason(detail.reason ?? '');
    setIssueDate(detail.issueDate ? String(detail.issueDate).slice(0, 10) : '');
    setNotes(detail.notes ?? '');
    setItems(detail.items.length
      ? detail.items.map((i) => ({ description: i.description, unitPrice: Number(i.unitPrice), unit: i.unit ?? '', quantity: Number(i.quantity), lineCurrency: i.lineCurrency, fxRate: Number(i.fxRate), taxExempt: i.taxExempt, accNo: i.accNo ?? '' }))
      : [emptyLine(detail.currency)]);
    setHydrated(true);
  }

  const setItem = (i: number, patch: Partial<Line>) => setItems((p) => p.map((it, x) => (x === i ? { ...it, ...patch } : it)));

  // When an invoice is picked, adopt its currency/tax and customer.
  const onPickInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = invoices?.items.find((x) => x.id === id);
    if (inv) { setCurrency(inv.currency); setTaxPct(Number(inv.taxPct)); setCustomerId(inv.customerId); }
  };

  // Preselected invoice (launched from the invoice list): adopt its
  // currency/tax/customer once the invoice list arrives.
  useEffect(() => {
    if (!note && initialInvoiceId && invoices && !customerId) {
      const inv = invoices.items.find((x) => x.id === initialInvoiceId);
      if (inv) { setCurrency(inv.currency); setTaxPct(Number(inv.taxPct)); setCustomerId(inv.customerId); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, initialInvoiceId]);

  const loadLines = useMutation({
    mutationFn: () => api<NoteDetail>(`/credit-debit-notes/from-invoice/${invoiceId}?type=${type}`),
    onSuccess: (d) => {
      setCurrency(d.currency); setTaxPct(Number(d.taxPct)); setCustomerId(d.customerId);
      setItems(d.items.length ? d.items.map((i) => ({ description: i.description, unitPrice: Number(i.unitPrice), unit: i.unit ?? '', quantity: Number(i.quantity), lineCurrency: i.lineCurrency, fxRate: Number(i.fxRate), taxExempt: i.taxExempt, accNo: i.accNo ?? '' })) : [emptyLine(d.currency)]);
    },
  });

  const totals = useMemo(() => {
    let subtotal = 0, taxable = 0;
    const lines = items.map((it) => {
      const amount = it.quantity * it.unitPrice * (it.fxRate || 1);
      subtotal += amount; if (!it.taxExempt) taxable += amount;
      return amount;
    });
    const taxAmt = taxable * (taxPct / 100);
    return { lines, subtotal, taxAmt, total: subtotal + taxAmt };
  }, [items, taxPct]);

  const hasItem = items.some((i) => i.description.trim());
  const needsInvoice = type === 'CREDIT' && !invoiceId;
  const needsCustomer = type === 'DEBIT' && !invoiceId && !customerId;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type,
        invoiceId: invoiceId || undefined,
        customerId: customerId || undefined,
        currency, taxPct, reason: reason || undefined, issueDate: issueDate || undefined, notes: notes || undefined,
        items: items.filter((i) => i.description.trim()).map((i) => ({
          description: i.description, unitPrice: i.unitPrice, unit: i.unit || undefined, quantity: i.quantity,
          lineCurrency: i.lineCurrency, fxRate: i.fxRate, taxExempt: i.taxExempt, accNo: i.accNo || undefined,
        })),
      };
      return note
        ? api(`/credit-debit-notes/${note.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/credit-debit-notes', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); onClose(); },
  });

  return (
    <Modal title={note ? `Edit ${note.noteNumber}` : `New ${label}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        <Card className="!p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={type === 'CREDIT' ? 'col-span-2' : 'col-span-2'}>
              <label className="label">Source Invoice {type === 'CREDIT' && <span className="text-red-500">*</span>}{type === 'DEBIT' && <span className="text-gray-400 font-normal"> (optional)</span>}</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <SearchableSelect value={invoiceId} onChange={onPickInvoice} placeholder="Search invoice…"
                    options={(invoices?.items ?? []).map((i) => ({ value: i.id, label: i.invoiceNumber, sublabel: i.customer.companyName }))} />
                </div>
                {invoiceId && <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs whitespace-nowrap" disabled={loadLines.isPending} onClick={() => loadLines.mutate()}>Load lines</button>}
              </div>
            </div>
            {type === 'DEBIT' && !invoiceId && (
              <div className="col-span-2">
                <label className="label">Customer <span className="text-red-500">*</span></label>
                <SearchableSelect value={customerId} onChange={setCustomerId} placeholder="Search customer…"
                  options={(customers?.items ?? []).map((c) => ({ value: c.id, label: c.companyName }))} />
              </div>
            )}
            <div><label className="label">Currency</label>
              <select className="input disabled:opacity-60" value={currency} disabled={!!invoiceId}
                title={invoiceId ? 'An invoice-linked note is always in the invoice currency' : undefined}
                onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label">SST %</label><input className="input" type="number" step="0.01" min="0" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} /></div>
            <div><label className="label">Issue Date</label><input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
            <div className="col-span-2 md:col-span-4"><label className="label">Reason <span className="text-red-500">*</span></label>
              <input className="input" placeholder="e.g. Overcharge on ocean freight / additional documentation fee" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
        </Card>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lines ({items.length})</div>
            <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => setItems([...items, emptyLine(currency)])}><Plus size={13} /> Add Line</button>
          </div>
          <div className="space-y-3">
            {items.map((item, i) => (
              <Card key={i} className="!p-0 overflow-visible">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-800 rounded-t-xl">
                  <span className="text-xs font-semibold text-gray-500">Line {i + 1}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" title="SST-exempt line (SVE 0%)">
                      <input type="checkbox" checked={item.taxExempt} onChange={(e) => setItem(i, { taxExempt: e.target.checked })} /> SST exempt
                    </label>
                    <button type="button" className="text-red-400 hover:text-red-600 disabled:opacity-30" disabled={items.length === 1} onClick={() => setItems(items.filter((_, x) => x !== i))}><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="p-3 space-y-3">
                  <div><label className="label !text-xs">Description <span className="text-red-500">*</span></label>
                    <input className="input" value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} /></div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                    <div><label className="label !text-xs">Line Ccy</label>
                      <select className="input" value={item.lineCurrency} onChange={(e) => setItem(i, { lineCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="label !text-xs">Unit Price</label><input className="input text-right" type="number" step="0.0001" min="0" value={item.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">UOM</label><input className="input" list="note-uom" value={item.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
                    <div><label className="label !text-xs">Qty</label><input className="input text-right" type="number" step="0.01" min="0.01" value={item.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">Ex. Rate</label><input className="input text-right" type="number" step="0.0001" min="0" value={item.fxRate} onChange={(e) => setItem(i, { fxRate: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">Acc No</label><input className="input" value={item.accNo} onChange={(e) => setItem(i, { accNo: e.target.value })} /></div>
                  </div>
                  <div className="text-right text-xs text-gray-500">Amount: <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtMoney(totals.lines[i] ?? 0, currency)}</span></div>
                </div>
              </Card>
            ))}
          </div>
          <datalist id="note-uom">{UOM.map((u) => <option key={u} value={u} />)}</datalist>
        </div>

        <div><label className="label">Notes</label><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

        <Card className="!bg-primary/5 dark:!bg-primary/10 !border-primary/20">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-gray-500">Subtotal</div><div className="font-semibold">{fmtMoney(totals.subtotal, currency)}</div></div>
            <div><div className="text-xs text-gray-500">Service Tax</div><div className="font-semibold">{fmtMoney(totals.taxAmt, currency)}</div></div>
            <div><div className="text-xs text-gray-500">{label} Total</div><div className="text-lg font-bold text-primary">{fmtMoney(totals.total, currency)}</div></div>
          </div>
        </Card>

        <ErrorText error={save.error || loadLines.error} />
        {(needsInvoice || needsCustomer || !hasItem || !reason.trim()) && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {needsInvoice ? 'A credit note requires a source invoice. ' : ''}
            {needsCustomer ? 'Select a customer or an invoice. ' : ''}
            {!reason.trim() ? 'Enter a reason. ' : ''}
            {!hasItem ? 'Add at least one line with a description.' : ''}
          </p>
        )}
        <button className="btn-primary w-full justify-center" disabled={needsInvoice || needsCustomer || !hasItem || !reason.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : `Save ${label}`}
        </button>
      </div>
    </Modal>
  );
}
