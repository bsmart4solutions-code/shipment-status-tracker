'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Mail, Package, Plus, Printer, Receipt, Ship, Trash2, Users } from 'lucide-react';
import { Shell } from '@/components/shell';
import { ColumnPicker, useColumns } from '@/components/column-picker';
import { Card, ErrorText, Modal, Pagination, SearchableSelect, StatusBadge, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { exportToXlsx } from '@/lib/xlsx-export';
import { EmailDialog } from '@/components/email-dialog';

const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
const INVOICE_COLS = ['Invoice #', 'Customer', 'Job', 'Total', 'Paid', 'Balance', 'Due Date', 'Status'];

interface InvoiceRow {
  id: string; invoiceNumber: string; currency: string; subtotal: string; taxPct: string; taxAmt: string;
  totalAmount: string; amountPaid: string; status: string; issueDate: string; dueDate: string | null;
  notes: string | null; customerId: string; jobId: string | null;
  customer: { companyName: string; code: string }; job: { jobNumber: string } | null;
}

export default function InvoicesPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<InvoiceRow | 'new' | null>(null);
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  const [showAging, setShowAging] = useState(false);
  const [emailFor, setEmailFor] = useState<InvoiceRow | null>(null);
  const cols = useColumns('invoices', INVOICE_COLS);

  const { data } = useQuery({
    queryKey: ['invoices', page, search, status],
    queryFn: () => api<{ items: InvoiceRow[]; pageCount: number }>(
      `/invoices?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('invoices.write');

  const issue = useMutation({
    mutationFn: (id: string) => api(`/invoices/${id}/issue`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/invoices/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });

  const exportXlsx = () => exportToXlsx('invoices.xlsx', (data?.items ?? []).map((inv) => ({
    'Invoice #': inv.invoiceNumber, Customer: inv.customer.companyName, Job: inv.job?.jobNumber ?? '',
    Currency: inv.currency, Subtotal: Number(inv.subtotal), Tax: Number(inv.taxAmt),
    Total: Number(inv.totalAmount), Paid: Number(inv.amountPaid),
    Balance: Number(inv.totalAmount) - Number(inv.amountPaid),
    'Issue Date': fmtDate(inv.issueDate), 'Due Date': fmtDate(inv.dueDate), Status: inv.status,
  })));

  return (
    <Shell title="Invoices" actions={
      <div className="flex gap-2">
        <ColumnPicker columns={cols} />
        <button className="btn-ghost" onClick={exportXlsx}>Export Excel</button>
        <button className="btn-ghost" onClick={() => setShowAging(true)}><Clock size={15} /> Aging Report</button>
        {canWrite && <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> New Invoice</button>}
      </div>
    }>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder="Search invoice #, customer…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[170px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <Table head={[...cols.visible, '']} empty={data?.items.length === 0}>
        {data?.items.map((inv) => {
          const balance = Number(inv.totalAmount) - Number(inv.amountPaid);
          return (
            <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              {cols.show('Invoice #') && <td className="td font-medium text-primary">{inv.invoiceNumber}</td>}
              {cols.show('Customer') && <td className="td">{inv.customer.companyName}</td>}
              {cols.show('Job') && <td className="td text-gray-500">{inv.job?.jobNumber ?? '-'}</td>}
              {cols.show('Total') && <td className="td">{fmtMoney(inv.totalAmount, inv.currency)}</td>}
              {cols.show('Paid') && <td className="td text-emerald-600">{fmtMoney(inv.amountPaid, inv.currency)}</td>}
              {cols.show('Balance') && <td className={`td font-medium ${balance > 0 ? 'text-red-500' : ''}`}>{fmtMoney(balance, inv.currency)}</td>}
              {cols.show('Due Date') && <td className="td text-gray-500">{fmtDate(inv.dueDate)}</td>}
              {cols.show('Status') && <td className="td"><StatusBadge status={inv.status} /></td>}
              <td className="td">
                <div className="flex gap-2 flex-wrap justify-end">
                  {canWrite && inv.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm" onClick={() => setEditing(inv)}>Edit</button>
                  )}
                  {canWrite && inv.status === 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm" onClick={() => issue.mutate(inv.id)}>Issue</button>
                  )}
                  {inv.status !== 'DRAFT' && (
                    <button className="text-primary hover:underline text-sm inline-flex items-center gap-1" onClick={() => router.push(`/invoices/${inv.id}/print`)}>
                      <Printer size={13} /> Print
                    </button>
                  )}
                  {canWrite && (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') && (
                    <button className="text-primary hover:underline text-sm" onClick={() => setPaying(inv)}>Record Payment</button>
                  )}
                  {canWrite && inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && (
                    <button className="text-primary hover:underline text-sm inline-flex items-center gap-1" onClick={() => setEmailFor(inv)}>
                      <Mail size={13} /> Email
                    </button>
                  )}
                  {canWrite && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                    <button className="text-red-500 hover:underline text-sm" onClick={() => cancel.mutate(inv.id)}>Cancel</button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>
      <ErrorText error={issue.error || cancel.error} />

      {editing && <InvoiceModal invoice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentModal invoice={paying} onClose={() => setPaying(null)} />}
      {showAging && <AgingModal onClose={() => setShowAging(false)} />}
      {emailFor && (
        <EmailDialog title={`Email invoice ${emailFor.invoiceNumber}`} endpoint={`/invoices/${emailFor.id}/email`} onClose={() => setEmailFor(null)} />
      )}
    </Shell>
  );
}

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];
const UOM_OPTIONS = ['SHPT', 'CONT', 'SET', "20'GP", "40'HC", 'M3', 'KG', 'TON', 'TRIP', 'PKG', 'UNIT', 'DAY'];

interface ItemRow {
  description: string; unitPrice: number; unit: string; quantity: number;
  lineCurrency: string; fxRate: number; taxExempt: boolean; accNo: string;
}

interface InvoiceDetail {
  id: string; customerId: string; jobId: string | null; currency: string; taxPct: string;
  dueDate: string | null; notes: string | null;
  billToCode: string | null; attn: string | null; salesman: string | null; terms: string | null; exRate: string | null;
  pol: string | null; pod: string | null; finalDestination: string | null; etd: string | null; eta: string | null;
  feederVessel: string | null; motherVessel: string | null; hblNo: string | null; oblNo: string | null;
  goods: string | null; measurement: string | null; containerInfo: string | null; noOfPackages: string | null;
  shipper: string | null; consignee: string | null;
  items: { description: string; unitPrice: string; unit: string | null; quantity: string; lineCurrency: string; fxRate: string; taxExempt: boolean; accNo: string | null }[];
}

function SectionHeader({ icon: Icon, title, action }: { icon: React.ElementType; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"><Icon size={13} /> {title}</div>
      {action}
    </div>
  );
}

const emptyItem = (ccy: string): ItemRow => ({ description: '', unitPrice: 0, unit: '', quantity: 1, lineCurrency: ccy, fxRate: 1, taxExempt: false, accNo: '' });

function InvoiceModal({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  // For an existing invoice, load the full detail (items + freight header).
  const { data: detail } = useQuery({
    queryKey: ['invoice-full', invoice?.id],
    queryFn: () => api<InvoiceDetail>(`/invoices/${invoice!.id}`),
    enabled: !!invoice,
  });

  const [customerId, setCustomerId] = useState('');
  const [jobId, setJobId] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [taxPct, setTaxPct] = useState(6);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [hdr, setHdr] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ItemRow[]>([emptyItem('MYR')]);
  const [hydrated, setHydrated] = useState(false);

  // Seed state once the detail arrives (edit) — new invoices keep the defaults.
  if (invoice && detail && !hydrated) {
    setCustomerId(detail.customerId);
    setJobId(detail.jobId ?? '');
    setCurrency(detail.currency);
    setTaxPct(Number(detail.taxPct));
    setDueDate(detail.dueDate?.slice(0, 10) ?? '');
    setNotes(detail.notes ?? '');
    setHdr({
      billToCode: detail.billToCode ?? '', attn: detail.attn ?? '', salesman: detail.salesman ?? '', terms: detail.terms ?? '',
      pol: detail.pol ?? '', pod: detail.pod ?? '', finalDestination: detail.finalDestination ?? '',
      etd: detail.etd?.slice(0, 10) ?? '', eta: detail.eta?.slice(0, 10) ?? '',
      feederVessel: detail.feederVessel ?? '', motherVessel: detail.motherVessel ?? '', hblNo: detail.hblNo ?? '', oblNo: detail.oblNo ?? '',
      goods: detail.goods ?? '', measurement: detail.measurement ?? '', containerInfo: detail.containerInfo ?? '',
      noOfPackages: detail.noOfPackages ?? '', shipper: detail.shipper ?? '', consignee: detail.consignee ?? '',
    });
    setItems(detail.items.length
      ? detail.items.map((i) => ({ description: i.description, unitPrice: Number(i.unitPrice), unit: i.unit ?? '', quantity: Number(i.quantity), lineCurrency: i.lineCurrency, fxRate: Number(i.fxRate), taxExempt: i.taxExempt, accNo: i.accNo ?? '' }))
      : [emptyItem(detail.currency)]);
    setHydrated(true);
  }

  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api<{ items: { id: string; companyName: string }[] }>('/customers?pageSize=200') });
  const { data: jobs } = useQuery({ queryKey: ['jobs-all'], queryFn: () => api<{ items: { id: string; jobNumber: string }[] }>('/jobs?pageSize=200') });

  const setItem = (i: number, patch: Partial<ItemRow>) => setItems((prev) => prev.map((it, x) => (x === i ? { ...it, ...patch } : it)));
  const setH = (k: string, v: string) => setHdr((h) => ({ ...h, [k]: v }));

  // Live totals mirroring the backend (SVE lines excluded from tax base).
  const totals = useMemo(() => {
    let subtotal = 0, taxable = 0;
    const lines = items.map((it) => {
      const amount = it.quantity * it.unitPrice * (it.fxRate || 1);
      subtotal += amount;
      if (!it.taxExempt) taxable += amount;
      return amount;
    });
    const taxAmt = taxable * (taxPct / 100);
    return { lines, subtotal, taxAmt, total: subtotal + taxAmt };
  }, [items, taxPct]);

  const hasValidItem = items.some((i) => i.description.trim());

  const save = useMutation({
    mutationFn: () => {
      const body = {
        customerId, jobId: jobId || undefined, currency, taxPct, dueDate: dueDate || undefined, notes: notes || undefined,
        ...Object.fromEntries(Object.entries(hdr).filter(([, v]) => v !== '')),
        exRate: hdr.exRate ? Number(hdr.exRate) : undefined,
        items: items.filter((i) => i.description.trim()).map((i) => ({
          description: i.description, unitPrice: i.unitPrice, unit: i.unit || undefined, quantity: i.quantity,
          lineCurrency: i.lineCurrency, fxRate: i.fxRate, taxExempt: i.taxExempt, accNo: i.accNo || undefined,
        })),
      };
      return invoice
        ? api(`/invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/invoices', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); onClose(); },
  });

  return (
    <Modal title={invoice ? `Edit ${invoice.invoiceNumber}` : 'New Invoice'} onClose={onClose} size="xl">
      <div className="space-y-5">
        <div>
          <SectionHeader icon={Users} title="Customer & Terms" />
          <Card className="!p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="label">Customer <span className="text-red-500">*</span></label>
                <SearchableSelect value={customerId} onChange={setCustomerId} placeholder="Search customer…"
                  options={(customers?.items ?? []).map((c) => ({ value: c.id, label: c.companyName }))} />
              </div>
              <div>
                <label className="label">Linked Job</label>
                <SearchableSelect value={jobId} onChange={setJobId} placeholder="Search job…"
                  options={(jobs?.items ?? []).map((j) => ({ value: j.id, label: j.jobNumber }))} />
              </div>
              <div><label className="label">Currency</label>
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label">SST %</label><input className="input" type="number" step="0.01" min="0" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} /></div>
              <div><label className="label">Terms</label><input className="input" placeholder="CASH" value={hdr.terms ?? ''} onChange={(e) => setH('terms', e.target.value)} /></div>
              <div><label className="label">Salesman</label><input className="input" value={hdr.salesman ?? ''} onChange={(e) => setH('salesman', e.target.value)} /></div>
              <div><label className="label">Due Date</label><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
          </Card>
        </div>

        <details className="group">
          <summary className="cursor-pointer list-none">
            <SectionHeader icon={Ship} title="Shipment Details (optional — printed on invoice)" action={<span className="text-xs text-primary group-open:hidden">Show</span>} />
          </summary>
          <Card className="!p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><label className="label">Bill-To Code</label><input className="input" placeholder="300-M0070" value={hdr.billToCode ?? ''} onChange={(e) => setH('billToCode', e.target.value)} /></div>
              <div><label className="label">Attn</label><input className="input" value={hdr.attn ?? ''} onChange={(e) => setH('attn', e.target.value)} /></div>
              <div><label className="label">Ex. Rate</label><input className="input" type="number" step="0.0001" value={hdr.exRate ?? ''} onChange={(e) => setH('exRate', e.target.value)} /></div>
              <div />
              <div><label className="label">POL</label><input className="input" value={hdr.pol ?? ''} onChange={(e) => setH('pol', e.target.value)} /></div>
              <div><label className="label">POD</label><input className="input" value={hdr.pod ?? ''} onChange={(e) => setH('pod', e.target.value)} /></div>
              <div><label className="label">Final Destination</label><input className="input" value={hdr.finalDestination ?? ''} onChange={(e) => setH('finalDestination', e.target.value)} /></div>
              <div />
              <div><label className="label">ETD</label><input className="input" type="date" value={hdr.etd ?? ''} onChange={(e) => setH('etd', e.target.value)} /></div>
              <div><label className="label">ETA</label><input className="input" type="date" value={hdr.eta ?? ''} onChange={(e) => setH('eta', e.target.value)} /></div>
              <div><label className="label">Feeder Vessel</label><input className="input" value={hdr.feederVessel ?? ''} onChange={(e) => setH('feederVessel', e.target.value)} /></div>
              <div><label className="label">Mother Vessel</label><input className="input" value={hdr.motherVessel ?? ''} onChange={(e) => setH('motherVessel', e.target.value)} /></div>
              <div><label className="label">HBL No</label><input className="input" value={hdr.hblNo ?? ''} onChange={(e) => setH('hblNo', e.target.value)} /></div>
              <div><label className="label">OBL No</label><input className="input" value={hdr.oblNo ?? ''} onChange={(e) => setH('oblNo', e.target.value)} /></div>
              <div className="col-span-2"><label className="label">Goods</label><input className="input" value={hdr.goods ?? ''} onChange={(e) => setH('goods', e.target.value)} /></div>
              <div><label className="label">Meas./Weight</label><input className="input" placeholder="632.4M3 / 61753KGS" value={hdr.measurement ?? ''} onChange={(e) => setH('measurement', e.target.value)} /></div>
              <div><label className="label">Container Info</label><input className="input" placeholder="10 X 40'HC" value={hdr.containerInfo ?? ''} onChange={(e) => setH('containerInfo', e.target.value)} /></div>
              <div><label className="label">No. of Packages</label><input className="input" placeholder="14986 CARTONS" value={hdr.noOfPackages ?? ''} onChange={(e) => setH('noOfPackages', e.target.value)} /></div>
              <div><label className="label">Shipper</label><input className="input" value={hdr.shipper ?? ''} onChange={(e) => setH('shipper', e.target.value)} /></div>
              <div><label className="label">Consignee</label><input className="input" value={hdr.consignee ?? ''} onChange={(e) => setH('consignee', e.target.value)} /></div>
            </div>
          </Card>
        </details>

        <div>
          <SectionHeader icon={Package} title={`Charge Items (${items.length})`} action={
            <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => setItems([...items, emptyItem(currency)])}><Plus size={13} /> Add Item</button>
          } />
          <div className="space-y-3">
            {items.map((item, i) => (
              <Card key={i} className="!p-0 overflow-visible">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-800 rounded-t-xl">
                  <span className="text-xs font-semibold text-gray-500">Item {i + 1}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" title="SST-exempt line (SVE 0%), e.g. ocean freight">
                      <input type="checkbox" checked={item.taxExempt} onChange={(e) => setItem(i, { taxExempt: e.target.checked })} /> SST exempt (SVE 0%)
                    </label>
                    <button type="button" className="text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed" disabled={items.length === 1}
                      title={items.length === 1 ? 'At least one item is required' : 'Remove item'} onClick={() => setItems(items.filter((_, x) => x !== i))}><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="p-3 space-y-3">
                  <div><label className="label !text-xs">Description <span className="text-red-500">*</span></label>
                    <input className="input" placeholder="e.g. OCEAN FREIGHT / THC / B/L FEE" value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} /></div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                    <div><label className="label !text-xs">Line Ccy</label>
                      <select className="input" value={item.lineCurrency} onChange={(e) => setItem(i, { lineCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="label !text-xs">Unit Price</label><input className="input text-right" type="number" step="0.0001" min="0" value={item.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">UOM</label><input className="input" list="inv-uom" placeholder="SHPT" value={item.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
                    <div><label className="label !text-xs">Qty</label><input className="input text-right" type="number" step="0.01" min="0.01" value={item.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">Ex. Rate</label><input className="input text-right" type="number" step="0.0001" min="0" value={item.fxRate} onChange={(e) => setItem(i, { fxRate: Number(e.target.value) })} /></div>
                    <div><label className="label !text-xs">Acc No</label><input className="input" placeholder="500-004" value={item.accNo} onChange={(e) => setItem(i, { accNo: e.target.value })} /></div>
                  </div>
                  <div className="text-right text-xs text-gray-500">Amount (excl tax): <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtMoney(totals.lines[i] ?? 0, currency)}</span></div>
                </div>
              </Card>
            ))}
          </div>
          <datalist id="inv-uom">{UOM_OPTIONS.map((u) => <option key={u} value={u} />)}</datalist>
        </div>

        <div>
          <SectionHeader icon={Receipt} title="Remark" />
          <textarea className="input" rows={2} placeholder="Notes printed on the invoice…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Card className="!bg-primary/5 dark:!bg-primary/10 !border-primary/20">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-gray-500">Subtotal (excl tax)</div><div className="font-semibold">{fmtMoney(totals.subtotal, currency)}</div></div>
            <div><div className="text-xs text-gray-500">Service Tax</div><div className="font-semibold">{fmtMoney(totals.taxAmt, currency)}</div></div>
            <div><div className="text-xs text-gray-500">Total (incl tax)</div><div className="text-lg font-bold text-primary">{fmtMoney(totals.total, currency)}</div></div>
          </div>
        </Card>

        <ErrorText error={save.error} />
        {!hasValidItem && <p className="text-sm text-amber-600 dark:text-amber-400">Add at least one charge item with a description before saving.</p>}
        <button className="btn-primary w-full justify-center" disabled={!customerId || !hasValidItem || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save Invoice'}
        </button>
      </div>
    </Modal>
  );
}

interface Payment {
  id: string; amount: string; paidAt: string; method: string | null; reference: string | null;
  recordedBy: { fullName: string } | null;
}

function PaymentModal({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ amount: 0, method: '', reference: '' });
  const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid);

  const { data: detail } = useQuery({
    queryKey: ['invoice-detail', invoice.id],
    queryFn: () => api<{ payments: Payment[] }>(`/invoices/${invoice.id}`),
  });

  const record = useMutation({
    mutationFn: () => api(`/invoices/${invoice.id}/payments`, { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice-detail', invoice.id] });
      setForm({ amount: 0, method: '', reference: '' });
    },
  });

  return (
    <Modal title={`Payments — ${invoice.invoiceNumber}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-gray-500">
          Total {fmtMoney(invoice.totalAmount, invoice.currency)} · Paid <span className="text-emerald-600">{fmtMoney(invoice.amountPaid, invoice.currency)}</span> · Balance <span className="text-red-500 font-medium">{fmtMoney(balance, invoice.currency)}</span>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {detail?.payments.length === 0 && <p className="text-sm text-gray-400">No payments recorded yet.</p>}
          {detail?.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm border-b border-gray-100 dark:border-gray-800 pb-1">
              <div>
                <div className="font-medium">{fmtMoney(p.amount, invoice.currency)}</div>
                <div className="text-xs text-gray-400">{p.method ?? 'Payment'}{p.reference ? ` · ${p.reference}` : ''} · {p.recordedBy?.fullName ?? '-'}</div>
              </div>
              <div className="text-gray-500">{fmtDate(p.paidAt)}</div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); record.mutate(); }} className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
          <div className="text-xs text-gray-500 uppercase font-semibold">Record Payment</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" type="number" step="0.01" placeholder="Amount" max={balance}
              value={form.amount || ''} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} required />
            <input className="input" placeholder="Method (bank transfer, cheque…)"
              value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} />
          </div>
          <input className="input" placeholder="Reference (optional)"
            value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
          <ErrorText error={record.error} />
          <button className="btn-primary w-full justify-center" disabled={record.isPending}>Add Payment</button>
        </form>
      </div>
    </Modal>
  );
}

interface AgingBucket { label: string; count: number; total: number }
interface AgingRow { invoiceNumber: string; customer: string; currency: string; balance: number; daysOverdue: number; bucket: string }

function AgingModal({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['invoices-aging'],
    queryFn: () => api<{ rows: AgingRow[]; buckets: AgingBucket[]; totalOutstanding: number }>('/invoices/aging'),
  });

  return (
    <Modal title="Invoice Aging Report" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-2">
          {data?.buckets.map((b) => (
            <div key={b.label} className="card p-3 text-center">
              <div className="text-xs text-gray-500 uppercase font-semibold">{b.label}</div>
              <div className="text-lg font-bold">{fmtMoney(b.total, 'MYR')}</div>
              <div className="text-xs text-gray-400">{b.count} invoice{b.count === 1 ? '' : 's'}</div>
            </div>
          ))}
        </div>
        <Table head={['Invoice #', 'Customer', 'Balance', 'Days Overdue', 'Bucket']} empty={data?.rows.length === 0}>
          {data?.rows.map((r) => (
            <tr key={r.invoiceNumber}>
              <td className="td font-medium text-primary">{r.invoiceNumber}</td>
              <td className="td">{r.customer}</td>
              <td className="td">{fmtMoney(r.balance, r.currency)}</td>
              <td className="td">{r.daysOverdue > 0 ? r.daysOverdue : '-'}</td>
              <td className="td"><StatusBadge status={r.bucket === 'Current' ? 'ACTIVE' : 'INACTIVE'} /> {r.bucket}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Modal>
  );
}
