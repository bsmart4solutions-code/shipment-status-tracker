'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calculator, CheckCircle2, FileText, History, Mail, MessageSquare, Package, Pencil, Plus,
  Receipt, Trash2, Users, XCircle,
} from 'lucide-react';
import { Shell } from '@/components/shell';
import { ColumnPicker, useColumns } from '@/components/column-picker';
import { EmailDialog } from '@/components/email-dialog';
import { Card, ErrorText, GpBadge, Modal, Pagination, SearchableSelect, StatusBadge, Table } from '@/components/ui';
import { api, downloadCsv, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { exportToXlsx } from '@/lib/xlsx-export';

interface QuoteRow {
  id: string; quoteNumber: string; quoteDate: string; validityDate: string | null;
  status: string; currency: string; totalCost: string; sellingPrice: string;
  grossProfit: string; gpPercent: string; approvalStatus: string;
  customer: { companyName: string }; salesPerson?: { fullName: string } | null;
}

const QUOTE_COLS = ['Quote #', 'Date', 'Customer', 'Sales', 'Valid Until', 'Total Cost', 'Selling Price', 'GP', 'GP %', 'Status'];

function ApprovalBadge({ status }: { status: string }) {
  if (!status || status === 'NOT_REQUIRED') return null;
  const cls = status === 'PENDING'
    ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    : status === 'APPROVED'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  return <span className={`badge text-xs ml-1 ${cls}`}>{status === 'PENDING' ? 'Needs approval' : status.toLowerCase()}</span>;
}

export default function QuotationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<QuoteRow | null>(null);
  const [emailFor, setEmailFor] = useState<QuoteRow | null>(null);
  const cols = useColumns('quotations', QUOTE_COLS);

  const { data } = useQuery({
    queryKey: ['quotations', page, search, status],
    queryFn: () => api<{ items: QuoteRow[]; pageCount: number }>(
      `/quotations?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`),
  });

  const canWrite = hasPermission('quotations.write');
  const canApprove = hasPermission('approvals.write');

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api(`/quotations/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });

  const exportXlsx = () => exportToXlsx('quotations.xlsx', (data?.items ?? []).map((q) => ({
    'Quote #': q.quoteNumber, Date: fmtDate(q.quoteDate), Customer: q.customer.companyName,
    Sales: q.salesPerson?.fullName ?? '', 'Valid Until': fmtDate(q.validityDate),
    Currency: q.currency, 'Total Cost': Number(q.totalCost), 'Selling Price': Number(q.sellingPrice),
    'Gross Profit': Number(q.grossProfit), 'GP %': Number(q.gpPercent), Status: q.status,
    Approval: q.approvalStatus,
  })));

  return (
    <Shell title="Quotations" actions={
      <div className="flex gap-2">
        <ColumnPicker columns={cols} />
        <button className="btn-ghost" onClick={exportXlsx}>Export Excel</button>
        <button className="btn-ghost" onClick={() => downloadCsv('/reports/quotations/export', 'quotations.csv')}>Export CSV</button>
        {canWrite && <button className="btn-primary" onClick={() => setShowBuilder(true)}><Plus size={15} /> New Quotation</button>}
      </div>
    }>
      <ErrorText error={decide.error} />
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input max-w-md" placeholder="Search quote number or customer…"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input max-w-[160px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {['DRAFT', 'SENT', 'WON', 'LOST', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <Table head={[...cols.visible, '']} empty={data?.items.length === 0}>
        {data?.items.map((q) => (
          <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            {cols.show('Quote #') && <td className="td font-medium"><Link className="text-primary hover:underline" href={`/quotations/${q.id}`}>{q.quoteNumber}</Link></td>}
            {cols.show('Date') && <td className="td text-gray-500">{fmtDate(q.quoteDate)}</td>}
            {cols.show('Customer') && <td className="td">{q.customer.companyName}</td>}
            {cols.show('Sales') && <td className="td text-gray-500">{q.salesPerson?.fullName ?? '-'}</td>}
            {cols.show('Valid Until') && <td className="td text-gray-500">{fmtDate(q.validityDate)}</td>}
            {cols.show('Total Cost') && <td className="td">{fmtMoney(q.totalCost, q.currency)}</td>}
            {cols.show('Selling Price') && <td className="td font-medium">{fmtMoney(q.sellingPrice, q.currency)}</td>}
            {cols.show('GP') && <td className="td text-emerald-600">{fmtMoney(q.grossProfit, q.currency)}</td>}
            {cols.show('GP %') && <td className="td"><GpBadge pct={q.gpPercent} /></td>}
            {cols.show('Status') && <td className="td"><StatusBadge status={q.status} /><ApprovalBadge status={q.approvalStatus} /></td>}
            <td className="td">
              <div className="flex gap-2 flex-wrap">
                {canApprove && q.approvalStatus === 'PENDING' && (
                  <>
                    <button className="text-emerald-600 hover:underline text-sm inline-flex items-center gap-1"
                      onClick={() => decide.mutate({ id: q.id, action: 'approve' })} disabled={decide.isPending}>
                      <CheckCircle2 size={13} /> Approve
                    </button>
                    <button className="text-red-500 hover:underline text-sm inline-flex items-center gap-1"
                      onClick={() => decide.mutate({ id: q.id, action: 'reject' })} disabled={decide.isPending}>
                      <XCircle size={13} /> Reject
                    </button>
                  </>
                )}
                {canWrite && !['WON', 'LOST', 'CANCELLED'].includes(q.status) && (
                  <button className="text-primary hover:underline text-sm inline-flex items-center gap-1" onClick={() => setEditId(q.id)}>
                    <Pencil size={13} /> Edit
                  </button>
                )}
                {canWrite && (
                  <button className="text-primary hover:underline text-sm inline-flex items-center gap-1" onClick={() => setEmailFor(q)}>
                    <Mail size={13} /> Email
                  </button>
                )}
                <button className="text-primary hover:underline text-sm inline-flex items-center gap-1" onClick={() => setHistoryFor(q)}>
                  <History size={13} /> History
                </button>
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3"><Pagination page={page} pageCount={data?.pageCount ?? 1} onChange={setPage} /></div>

      {showBuilder && <QuotationBuilder onClose={() => setShowBuilder(false)} />}
      {editId && <QuotationBuilder editId={editId} onClose={() => setEditId(null)} />}
      {historyFor && <RevisionsModal quote={historyFor} onClose={() => setHistoryFor(null)} />}
      {emailFor && (
        <EmailDialog
          title={`Email quotation ${emailFor.quoteNumber}`}
          endpoint={`/quotations/${emailFor.id}/email`}
          onClose={() => setEmailFor(null)}
        />
      )}
    </Shell>
  );
}


// ─────────────────── Revision history ───────────────────

interface Revision {
  id: string; revision: number; status: string; sellingPrice: string; grossProfit: string;
  createdAt: string; createdBy: { fullName: string } | null;
}

function RevisionsModal({ quote, onClose }: { quote: QuoteRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['quotation-revisions', quote.id],
    queryFn: () => api<Revision[]>(`/quotations/${quote.id}/revisions`),
  });

  return (
    <Modal title={`Version history — ${quote.quoteNumber}`} onClose={onClose}>
      <p className="text-sm text-gray-500 mb-3">
        A snapshot is saved each time a <strong>sent</strong> quotation is edited, preserving the terms
        the customer had already seen. The current live version is <StatusBadge status={quote.status} />.
      </p>
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-gray-400 py-6 text-center">No prior revisions — this quotation hasn&apos;t been edited after being sent.</p>
      )}
      {data && data.length > 0 && (
        <Table head={['Rev', 'Status when saved', 'Selling Price', 'Gross Profit', 'Saved', 'By']}>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="td font-medium">v{r.revision}</td>
              <td className="td"><StatusBadge status={r.status} /></td>
              <td className="td">{fmtMoney(r.sellingPrice, quote.currency)}</td>
              <td className="td text-emerald-600">{fmtMoney(r.grossProfit, quote.currency)}</td>
              <td className="td text-gray-500">{fmtDate(r.createdAt)}</td>
              <td className="td text-gray-500">{r.createdBy?.fullName ?? '-'}</td>
            </tr>
          ))}
        </Table>
      )}
    </Modal>
  );
}

// ─────────────────── Quotation Builder (costing engine UI) ───────────────────

interface ItemDraft {
  serviceId: string; vendorId: string; rateId?: string; description: string;
  quantity: number; unit: string; costCurrency: string; unitCost: number;
  minimumCharge?: number; markupPct: number; taxExempt: boolean;
}

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];
const UNIT_OPTIONS = ['KG', 'CBM', 'TON', 'CONTAINER 20FT', 'CONTAINER 40FT', 'TRIP', 'SET', 'PKG', 'LOT', 'SHIPMENT', 'HOUR', 'DAY'];
const MODES = ['Sea Freight', 'Air Freight', 'Rail', 'Truck', 'Multimodal'];
const SHIPMENT_TYPES = ['FCL', 'LCL', 'Air', 'Truck', 'Full Container Load', 'LCL Cargo', 'Transhipment'];
const SHIPPING_TERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

function SectionHeader({ icon: Icon, title, action }: { icon: React.ElementType; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Icon size={13} /> {title}
      </div>
      {action}
    </div>
  );
}

function QuotationBuilder({ editId, onClose }: { editId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [discountPct, setDiscountPct] = useState(0);
  const [serviceChargePct, setServiceChargePct] = useState(0);
  const [miscCharge, setMiscCharge] = useState(0);
  const [taxPct, setTaxPct] = useState(6);
  const [remark, setRemark] = useState('');
  // Freight header printed on the quotation (Solid Xpress format)
  const [subject, setSubject] = useState('');
  const [yourRef, setYourRef] = useState('');
  const [attn, setAttn] = useState('');
  const [pol, setPol] = useState('');
  const [pod, setPod] = useState('');
  const [finalDestination, setFinalDestination] = useState('');
  const [modeOfTransport, setModeOfTransport] = useState('');
  const [shipmentType, setShipmentType] = useState('');
  const [carrier, setCarrier] = useState('');
  const [transitTime, setTransitTime] = useState('');
  const [freeTime, setFreeTime] = useState('');
  const [goods, setGoods] = useState('');
  const [cargoWeight, setCargoWeight] = useState('');
  const [cargoVolume, setCargoVolume] = useState('');
  const [shippingTerm, setShippingTerm] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('CASH');
  const [validityDate, setValidityDate] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([
    { serviceId: '', vendorId: '', description: '', quantity: 1, unit: '', costCurrency: 'MYR', unitCost: 0, markupPct: 20, taxExempt: false },
  ]);
  const [hydrated, setHydrated] = useState(false);
  // A quote with no priced line items isn't a real quotation — mirrors the
  // backend's @ArrayMinSize(1) guard on CreateQuotationDto.items.
  const hasValidItem = items.some((i) => i.serviceId);

  // Editing: load the existing quotation and hydrate the form once.
  const { data: editQuote } = useQuery({
    queryKey: ['quotation-edit', editId],
    queryFn: () => api<any>(`/quotations/${editId}`),
    enabled: !!editId,
  });
  if (editId && editQuote && !hydrated) {
    setCustomerId(editQuote.customerId);
    setCurrency(editQuote.currency);
    setDiscountPct(Number(editQuote.discountPct));
    setServiceChargePct(Number(editQuote.serviceChargePct));
    setMiscCharge(Number(editQuote.miscCharge));
    setTaxPct(Number(editQuote.taxPct));
    setRemark(editQuote.remark ?? '');
    setSubject(editQuote.subject ?? '');
    setYourRef(editQuote.yourRef ?? '');
    setAttn(editQuote.attn ?? '');
    setPol(editQuote.pol ?? '');
    setPod(editQuote.pod ?? '');
    setFinalDestination(editQuote.finalDestination ?? '');
    setModeOfTransport(editQuote.modeOfTransport ?? '');
    setShipmentType(editQuote.shipmentType ?? '');
    setCarrier(editQuote.carrier ?? '');
    setTransitTime(editQuote.transitTime ?? '');
    setFreeTime(editQuote.freeTime ?? '');
    setGoods(editQuote.goods ?? '');
    setCargoWeight(editQuote.cargoWeight ?? '');
    setCargoVolume(editQuote.cargoVolume ?? '');
    setShippingTerm(editQuote.shippingTerm ?? '');
    setPaymentTerm(editQuote.paymentTerm ?? '');
    setValidityDate(editQuote.validityDate ? String(editQuote.validityDate).slice(0, 10) : '');
    setExclusions(editQuote.exclusions ?? '');
    setItems(editQuote.items.map((i: any) => ({
      serviceId: i.serviceId, vendorId: i.vendorId ?? '', rateId: i.rateId ?? undefined,
      description: i.description ?? '', quantity: Number(i.quantity), unit: i.unit ?? '',
      costCurrency: i.costCurrency, unitCost: Number(i.unitCost),
      minimumCharge: i.minimumCharge != null ? Number(i.minimumCharge) : undefined,
      markupPct: Number(i.markupPct), taxExempt: i.taxExempt,
    })));
    setHydrated(true);
  }

  const { data: customers } = useQuery({ queryKey: ['customers-all'], queryFn: () => api<{ items: { id: string; companyName: string }[] }>('/customers?pageSize=200') });
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => api<{ id: string; name: string }[]>('/services') });
  const { data: vendors } = useQuery({ queryKey: ['vendors-all'], queryFn: () => api<{ items: { id: string; name: string }[] }>('/vendors?pageSize=200') });
  const { data: fxRates } = useQuery({ queryKey: ['fx'], queryFn: () => api<{ baseCurrency: string; quoteCurrency: string; rate: string }[]>('/fx').catch(() => []) });

  /** Client-side mirror of the backend costing engine for live preview. */
  const preview = useMemo(() => {
    const fx = (from: string) => {
      if (from === currency) return 1;
      const direct = fxRates?.find((r) => r.baseCurrency === from && r.quoteCurrency === currency);
      if (direct) return Number(direct.rate);
      const inv = fxRates?.find((r) => r.baseCurrency === currency && r.quoteCurrency === from);
      return inv ? 1 / Number(inv.rate) : 1;
    };
    let totalCost = 0, subtotal = 0, taxableSubtotal = 0;
    const lines = items.map((i) => {
      const rate = fx(i.costCurrency);
      const raw = i.quantity * i.unitCost * rate;
      const min = (i.minimumCharge ?? 0) * rate;
      const cost = Math.max(raw, min);
      const unitSell = i.unitCost * rate * (1 + i.markupPct / 100);
      const sell = Math.max(i.quantity * unitSell, min > 0 && raw < min ? min * (1 + i.markupPct / 100) : 0);
      totalCost += cost;
      subtotal += sell;
      if (!i.taxExempt) taxableSubtotal += sell;
      return { cost, sell, gp: sell - cost };
    });
    const discount = subtotal * (discountPct / 100);
    const svc = (subtotal - discount) * (serviceChargePct / 100);
    const net = subtotal - discount + svc + Number(miscCharge || 0);
    // Mirrors the backend engine: SST-exempt lines (ocean freight) are
    // excluded from the tax base; header adjustments split proportionally.
    const taxableRatio = subtotal > 0 ? taxableSubtotal / subtotal : 1;
    const tax = ((subtotal - discount + svc) * taxableRatio + Number(miscCharge || 0)) * (taxPct / 100);
    return {
      lines, totalCost, subtotal, net, tax, grand: net + tax,
      gp: net - totalCost, gpPct: net > 0 ? ((net - totalCost) / net) * 100 : 0,
    };
  }, [items, currency, discountPct, serviceChargePct, miscCharge, taxPct, fxRates]);

  /** Fetch best vendor rate for the selected service+vendor lane and prefill cost. */
  async function autofillFromRates(index: number, serviceId: string) {
    const res = await api<{ items: { vendorId: string; cost: number; currency: string; minimumCharge: number | null; rateId: string; rateType: string }[]; recommendation: { vendorId: string; cost: number; currency: string; minimumCharge: number | null; rateId: string } | null }>(`/rates/compare?serviceId=${serviceId}`).catch(() => null);
    if (!res?.recommendation) return;
    setItems((prev) => prev.map((it, i) => i === index
      ? { ...it, vendorId: res.recommendation!.vendorId, unitCost: res.recommendation!.cost, costCurrency: res.recommendation!.currency, minimumCharge: res.recommendation!.minimumCharge ?? undefined, rateId: res.recommendation!.rateId }
      : it));
  }

  const save = useMutation({
    mutationFn: () => api(editId ? `/quotations/${editId}` : '/quotations', {
      method: editId ? 'PUT' : 'POST',
      body: JSON.stringify({
        customerId, currency, discountPct, serviceChargePct, miscCharge, taxPct, remark,
        subject: subject || undefined, yourRef: yourRef || undefined, attn: attn || undefined,
        pol: pol || undefined, pod: pod || undefined, finalDestination: finalDestination || undefined,
        modeOfTransport: modeOfTransport || undefined, shipmentType: shipmentType || undefined,
        carrier: carrier || undefined, transitTime: transitTime || undefined, freeTime: freeTime || undefined,
        goods: goods || undefined, cargoWeight: cargoWeight || undefined, cargoVolume: cargoVolume || undefined,
        shippingTerm: shippingTerm || undefined, paymentTerm: paymentTerm || undefined,
        validityDate: validityDate || undefined, exclusions: exclusions || undefined,
        items: items.filter((i) => i.serviceId).map((i) => ({
          ...i, vendorId: i.vendorId || undefined, rateId: i.rateId || undefined,
          minimumCharge: i.minimumCharge || undefined,
        })),
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotations'] });
      if (editId) qc.invalidateQueries({ queryKey: ['quotation', editId] });
      onClose();
    },
  });

  const set = (index: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  return (
    <Modal title={editId ? `Edit Quotation — ${editQuote?.quoteNumber ?? ''}` : 'New Quotation — Costing Engine'} onClose={onClose} size="xl">
      <div className="space-y-5">
        <div>
          <SectionHeader icon={Users} title="Customer & Terms" />
          <Card className="!p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="label">Customer <span className="text-red-500">*</span></label>
                <SearchableSelect
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="Search customer…"
                  options={(customers?.items ?? []).map((c) => ({ value: c.id, label: c.companyName }))}
                />
              </div>
              <div><label className="label">Quote Currency</label>
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label">SST %</label><input className="input" type="number" step="0.01" min="0" value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} /></div>
              <div className="col-span-2">
                <label className="label">Attn <span className="text-gray-400 font-normal">(contact person)</span></label>
                <input className="input" placeholder="e.g. MR JAMES" value={attn} onChange={(e) => setAttn(e.target.value)} />
              </div>
              <div><label className="label">Your Ref No</label><input className="input" value={yourRef} onChange={(e) => setYourRef(e.target.value)} /></div>
              <div><label className="label">Payment Term</label><input className="input" placeholder="CASH" value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} /></div>
            </div>
          </Card>
        </div>

        <div>
          <SectionHeader icon={FileText} title="Shipment Details" />
          <Card className="!p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2 md:col-span-4">
                <label className="label">Subject <span className="text-gray-400 font-normal">(RE line — auto-generated from POL/POD if left blank)</span></label>
                <input className="input" placeholder="e.g. QUOTATION FOR SEA EXPORT FROM PKG TO KUCHING DOOR" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div><label className="label">POL <span className="text-gray-400 font-normal">(Port of Loading)</span></label>
                <input className="input" placeholder="PORT KLANG, MALAYSIA" value={pol} onChange={(e) => setPol(e.target.value)} /></div>
              <div><label className="label">POD <span className="text-gray-400 font-normal">(Port of Discharge)</span></label>
                <input className="input" placeholder="KUCHING, MALAYSIA" value={pod} onChange={(e) => setPod(e.target.value)} /></div>
              <div><label className="label">Final Destination <span className="text-gray-400 font-normal">(if door)</span></label>
                <input className="input" placeholder="e.g. SHANGHAI DOOR" value={finalDestination} onChange={(e) => setFinalDestination(e.target.value)} /></div>
              <div>
                <label className="label">Mode of Transport</label>
                <input className="input" list="quote-modes" placeholder="Sea Freight" value={modeOfTransport} onChange={(e) => setModeOfTransport(e.target.value)} />
                <datalist id="quote-modes">{MODES.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div>
                <label className="label">Service Type</label>
                <input className="input" list="quote-shipment-types" placeholder="FCL / LCL / Air" value={shipmentType} onChange={(e) => setShipmentType(e.target.value)} />
                <datalist id="quote-shipment-types">{SHIPMENT_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div>
                <label className="label">Shipping Term <span className="text-gray-400 font-normal">(Incoterm)</span></label>
                <input className="input" list="quote-shipping-terms" placeholder="FOB" value={shippingTerm} onChange={(e) => setShippingTerm(e.target.value)} />
                <datalist id="quote-shipping-terms">{SHIPPING_TERMS.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div><label className="label">Carrier <span className="text-gray-400 font-normal">(leave blank = TBA)</span></label>
                <input className="input" placeholder="TBA" value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
              <div><label className="label">Transit Time</label>
                <input className="input" placeholder="e.g. 7-9 days / TBA" value={transitTime} onChange={(e) => setTransitTime(e.target.value)} /></div>
              <div><label className="label">Free Time</label>
                <input className="input" placeholder="e.g. 14 days" value={freeTime} onChange={(e) => setFreeTime(e.target.value)} /></div>
              <div><label className="label">Validity <span className="text-gray-400 font-normal">(blank = +30 days)</span></label>
                <input className="input" type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} /></div>
              <div className="col-span-2"><label className="label">Commodity / Goods</label>
                <input className="input" placeholder="e.g. GEARBOX (general cargo)" value={goods} onChange={(e) => setGoods(e.target.value)} /></div>
              <div><label className="label">Cargo Weight</label>
                <input className="input" placeholder="e.g. 20,000 KG" value={cargoWeight} onChange={(e) => setCargoWeight(e.target.value)} /></div>
              <div><label className="label">Cargo Volume</label>
                <input className="input" placeholder="e.g. 58 CBM" value={cargoVolume} onChange={(e) => setCargoVolume(e.target.value)} /></div>
              <div className="col-span-2 md:col-span-4"><label className="label">Exclusions <span className="text-gray-400 font-normal">(what this quote does not cover)</span></label>
                <textarea className="input" rows={2} placeholder="e.g. Insurance, duties & taxes, destination customs clearance, demurrage/detention beyond free time" value={exclusions} onChange={(e) => setExclusions(e.target.value)} /></div>
            </div>
          </Card>
        </div>

        <div>
          <SectionHeader icon={Package} title={`Cost Items (${items.length})`} action={
            <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs"
              onClick={() => setItems([...items, { serviceId: '', vendorId: '', description: '', quantity: 1, unit: '', costCurrency: currency, unitCost: 0, markupPct: 20, taxExempt: false }])}>
              <Plus size={13} /> Add Item
            </button>
          } />
          <div className="space-y-3">
            {items.map((item, i) => (
              <Card key={i} className="!p-0 overflow-visible">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-800 rounded-t-xl">
                  <span className="text-xs font-semibold text-gray-500">Item {i + 1}</span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" title="SST-exempt line, printed as tax code SVE 0% (e.g. ocean freight)">
                      <input type="checkbox" checked={item.taxExempt} onChange={(e) => set(i, { taxExempt: e.target.checked })} />
                      SST exempt (SVE 0%)
                    </label>
                    <button type="button" className="text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-red-400"
                      disabled={items.length === 1}
                      title={items.length === 1 ? 'At least one item is required' : 'Remove item'}
                      onClick={() => setItems(items.filter((_, x) => x !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="col-span-2">
                      <label className="label !text-xs">Service <span className="text-red-500">*</span></label>
                      <SearchableSelect
                        value={item.serviceId}
                        onChange={(v) => {
                          // Ocean freight is SST-exempt per the standard T&C —
                          // pre-tick the SVE flag (still manually overridable).
                          const svcName = services?.find((s) => s.id === v)?.name ?? '';
                          set(i, { serviceId: v, taxExempt: /sea freight|ocean/i.test(svcName) ? true : item.taxExempt });
                          if (v) autofillFromRates(i, v);
                        }}
                        placeholder="Search service…"
                        options={(services ?? []).map((s) => ({ value: s.id, label: s.name }))}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="label !text-xs">Vendor <span className="text-gray-400 font-normal normal-case">(auto-recommended)</span></label>
                      <SearchableSelect
                        value={item.vendorId}
                        onChange={(v) => set(i, { vendorId: v })}
                        placeholder="Search vendor…"
                        options={(vendors?.items ?? []).map((v) => ({ value: v.id, label: v.name }))}
                      />
                    </div>
                    <div><label className="label !text-xs">Cost Ccy</label>
                      <select className="input" value={item.costCurrency} onChange={(e) => set(i, { costCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                  </div>
                  <div>
                    <label className="label !text-xs">Description</label>
                    <input className="input" placeholder="e.g. Ocean freight KUL–SIN, 1× 20' container" value={item.description} onChange={(e) => set(i, { description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                    <div><label className="label !text-xs">Qty</label><input className="input text-right" type="number" step="0.01" min="0.01" value={item.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} /></div>
                    <div>
                      <label className="label !text-xs">Unit</label>
                      <input className="input" list="quote-unit-options" placeholder="KG" value={item.unit} onChange={(e) => set(i, { unit: e.target.value })} />
                    </div>
                    <div>
                      <label className="label !text-xs">Unit Cost</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{item.costCurrency}</span>
                        <input className="input !pl-14 text-right" type="number" step="0.0001" min="0" value={item.unitCost} onChange={(e) => set(i, { unitCost: Number(e.target.value) })} />
                      </div>
                    </div>
                    <div><label className="label !text-xs">Markup %</label><input className="input text-right" type="number" step="0.01" min="0" value={item.markupPct} onChange={(e) => set(i, { markupPct: Number(e.target.value) })} /></div>
                    <div className="text-right text-xs text-gray-500 leading-tight pb-2">
                      <div>Sell <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtMoney(preview.lines[i]?.sell ?? 0, currency)}</span></div>
                      <div>GP <span className="text-emerald-600 font-medium">{fmtMoney(preview.lines[i]?.gp ?? 0, currency)}</span></div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <datalist id="quote-unit-options">
            {UNIT_OPTIONS.map((u) => <option key={u} value={u} />)}
          </datalist>
        </div>

        <div>
          <SectionHeader icon={Receipt} title="Adjustments & Charges" />
          <Card className="!p-4">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Discount %</label><input className="input" type="number" step="0.01" value={discountPct} onChange={(e) => setDiscountPct(Number(e.target.value))} /></div>
              <div><label className="label">Service Charge %</label><input className="input" type="number" step="0.01" value={serviceChargePct} onChange={(e) => setServiceChargePct(Number(e.target.value))} /></div>
              <div><label className="label">Misc Charges</label><input className="input" type="number" step="0.01" value={miscCharge} onChange={(e) => setMiscCharge(Number(e.target.value))} /></div>
            </div>
          </Card>
        </div>

        <div>
          <SectionHeader icon={MessageSquare} title="Remark" />
          <textarea className="input" rows={2} placeholder="Internal notes or terms shown to the customer…" value={remark} onChange={(e) => setRemark(e.target.value)} />
        </div>

        <div>
          <SectionHeader icon={Calculator} title="Summary" />
          <Card className="!bg-primary/5 dark:!bg-primary/10 !border-primary/20">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div><div className="text-xs text-gray-500">Total Cost</div><div className="font-semibold">{fmtMoney(preview.totalCost, currency)}</div></div>
              <div><div className="text-xs text-gray-500">Net Sell (before tax)</div><div className="font-semibold">{fmtMoney(preview.net, currency)}</div></div>
              <div><div className="text-xs text-gray-500">Tax</div><div className="font-semibold">{fmtMoney(preview.tax, currency)}</div></div>
              <div><div className="text-xs text-gray-500">Selling Price</div><div className="text-lg font-bold text-primary">{fmtMoney(preview.grand, currency)}</div></div>
              <div><div className="text-xs text-gray-500">Gross Profit</div>
                <div className="font-bold text-emerald-600">{fmtMoney(preview.gp, currency)} <GpBadge pct={preview.gpPct} /></div></div>
            </div>
          </Card>
        </div>

        <ErrorText error={save.error} />
        {!hasValidItem && (
          <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <FileText size={14} /> Add at least one cost item with a service selected before saving.
          </p>
        )}
        <button className="btn-primary w-full justify-center" disabled={!customerId || !hasValidItem || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : editId ? 'Save Changes' : 'Create Quotation'}
        </button>
      </div>
    </Modal>
  );
}
