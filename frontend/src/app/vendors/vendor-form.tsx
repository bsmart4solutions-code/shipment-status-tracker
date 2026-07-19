'use client';

/**
 * Vendor master profile — a tabbed, ERP-grade New/Edit form for suppliers
 * (shipping lines, hauliers, agents…). Mirrors the customer master but with
 * supplier-oriented fields: our payment terms with them, banking (we pay
 * them), procurement lead time, and compliance/contract lifecycle. Scalar
 * fields plus dynamic child collections that map 1:1 to the nested-write API.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, ErrorText, SearchableSelect } from '@/components/ui';
import { api } from '@/lib/api';

const TABS = ['General', 'Contacts', 'Addresses', 'Finance', 'Procurement', 'Compliance', 'Docs & Bank', 'Notes'] as const;
type Tab = typeof TABS[number];

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];
const ADDRESS_TYPES = ['REGISTERED', 'BILLING', 'SHIPPING', 'WAREHOUSE'];
const COMM_METHODS = ['EMAIL', 'PHONE', 'WHATSAPP', 'SMS'];
const VENDOR_TYPES = ['SHIPPING_LINE', 'HAULIER', 'FORWARDING_AGENT', 'CUSTOMS_BROKER', 'WAREHOUSE', 'COURIER', 'AIRLINE', 'SUPPLIER', 'OTHER'];
const MODES = ['Sea', 'Air', 'Land', 'Rail', 'Courier'];
const DOC_CATEGORIES = ['Business Registration', 'Tax Certificate', 'Company Profile', 'Insurance', 'Signed Agreement', 'License', 'Other'];

interface Contact { name: string; position: string; department: string; mobile: string; phone: string; email: string; remarks: string }
interface Address { type: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; isPrimary: boolean }
interface BankAccount { bankName: string; accountName: string; accountNumber: string; swift: string; bankAddress: string }
interface DocRow { name: string; category: string; link: string; notes: string }
type Scalars = Record<string, string | number | boolean | null>;

const emptyContact = (): Contact => ({ name: '', position: '', department: '', mobile: '', phone: '', email: '', remarks: '' });
const emptyAddress = (t = 'BILLING'): Address => ({ type: t, line1: '', line2: '', city: '', state: '', postalCode: '', country: 'Malaysia', isPrimary: false });
const emptyBank = (): BankAccount => ({ bankName: '', accountName: '', accountNumber: '', swift: '', bankAddress: '' });
const emptyDoc = (): DocRow => ({ name: '', category: '', link: '', notes: '' });
const d10 = (s?: string | null) => (s ? String(s).slice(0, 10) : '');

export function VendorModal({ vendor, onClose }: { vendor: { id: string; code: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('General');

  const { data: detail } = useQuery({
    queryKey: ['vendor-full', vendor?.id],
    queryFn: () => api<Record<string, unknown>>(`/vendors/${vendor!.id}`),
    enabled: !!vendor,
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; fullName: string }[]>('/users').catch(() => []) });

  const [f, setF] = useState<Scalars>({
    name: '', vendorType: 'SUPPLIER', status: 'ACTIVE', currency: 'MYR', isPreferred: false, taxExempt: false, blacklist: false,
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  if (vendor && detail && !hydrated) {
    const d = detail as Record<string, unknown>;
    const num = (v: unknown) => (v == null ? null : Number(v));
    setF({
      ...f,
      name: (d.name as string) ?? '', vendorType: (d.vendorType as string) ?? 'SUPPLIER',
      registrationNo: (d.registrationNo as string) ?? '', taxId: (d.taxId as string) ?? '', website: (d.website as string) ?? '',
      category: (d.category as string) ?? '', servicesProvided: (d.servicesProvided as string) ?? '',
      contactPerson: (d.contactPerson as string) ?? '', contactTitle: (d.contactTitle as string) ?? '', mobile: (d.mobile as string) ?? '',
      phone: (d.phone as string) ?? '', officePhone: (d.officePhone as string) ?? '', extension: (d.extension as string) ?? '',
      email: (d.email as string) ?? '', whatsapp: (d.whatsapp as string) ?? '', preferredComm: (d.preferredComm as string) ?? '',
      address: (d.address as string) ?? '',
      paymentTerm: (d.paymentTerm as string) ?? '', currency: (d.currency as string) ?? 'MYR', creditLimit: num(d.creditLimit),
      taxType: (d.taxType as string) ?? '', taxExempt: !!d.taxExempt, openingBalance: num(d.openingBalance), openingBalanceDate: d10(d.openingBalanceDate as string),
      assignedBuyerId: (d.assignedBuyerId as string) ?? '', preferredMode: (d.preferredMode as string) ?? '', leadTimeDays: num(d.leadTimeDays),
      deliveryTerms: (d.deliveryTerms as string) ?? '', minOrderValue: num(d.minOrderValue),
      apAccount: (d.apAccount as string) ?? '', vendorAccountCode: (d.vendorAccountCode as string) ?? '', taxCategory: (d.taxCategory as string) ?? '', financeRemarks: (d.financeRemarks as string) ?? '',
      status: (d.status as string) ?? 'ACTIVE', isPreferred: !!d.isPreferred, onboardedDate: d10(d.onboardedDate as string),
      contractStart: d10(d.contractStart as string), contractEnd: d10(d.contractEnd as string), insuranceExpiry: d10(d.insuranceExpiry as string),
      licenseNo: (d.licenseNo as string) ?? '', nextReviewDate: d10(d.nextReviewDate as string),
      notes: (d.notes as string) ?? '', warnings: (d.warnings as string) ?? '', blacklist: !!d.blacklist,
    });
    setContacts(((d.contacts as Contact[]) ?? []).map((c) => ({ ...emptyContact(), ...c })));
    setAddresses(((d.addresses as Address[]) ?? []).map((a) => ({ ...emptyAddress(), ...a })));
    setBanks(((d.bankAccounts as BankAccount[]) ?? []).map((b) => ({ ...emptyBank(), ...b })));
    setDocs(((d.documents as DocRow[]) ?? []).map((x) => ({ ...emptyDoc(), ...x })));
    setHydrated(true);
  }

  const set = (k: string, v: unknown) => setF((prev) => ({ ...prev, [k]: v as never }));

  const save = useMutation({
    mutationFn: () => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) { if (v === '' || v === null) continue; clean[k] = v; }
      clean.name = f.name;
      const body = {
        ...clean,
        contacts: contacts.filter((c) => c.name.trim()).map(stripBlank),
        addresses: addresses.filter((a) => a.line1.trim() || a.city.trim()).map(stripBlank),
        bankAccounts: banks.filter((b) => b.bankName.trim() || b.accountNumber.trim()).map(stripBlank),
        documents: docs.filter((x) => x.name.trim()).map(stripBlank),
      };
      return vendor
        ? api(`/vendors/${vendor.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/vendors', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendors'] }); onClose(); },
  });

  const emailInvalid = !!f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email));

  return (
    <Modal title={vendor ? `Edit ${vendor.code}` : 'New Vendor'} onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800 -mx-1 px-1">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'General' && (
          <div className="space-y-4">
            <Section title="Company Information">
              <Grid>
                <Field span={2} label="Vendor Name" required><input className="input" value={s(f.name)} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Vendor Type"><select className="input" value={s(f.vendorType)} onChange={(e) => set('vendorType', e.target.value)}>{VENDOR_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Category"><input className="input" placeholder="e.g. Ocean carrier" value={s(f.category)} onChange={(e) => set('category', e.target.value)} /></Field>
                <Field label="Registration No."><input className="input" value={s(f.registrationNo)} onChange={(e) => set('registrationNo', e.target.value)} /></Field>
                <Field label="Tax ID (GST/SST)"><input className="input" value={s(f.taxId)} onChange={(e) => set('taxId', e.target.value)} /></Field>
                <Field label="Website"><input className="input" placeholder="www.example.com" value={s(f.website)} onChange={(e) => set('website', e.target.value)} /></Field>
                <Field span={2} label="Services Provided"><input className="input" placeholder="FCL, LCL, haulage, customs…" value={s(f.servicesProvided)} onChange={(e) => set('servicesProvided', e.target.value)} /></Field>
              </Grid>
            </Section>
            <Section title="Primary Contact">
              <Grid>
                <Field label="Contact Person"><input className="input" value={s(f.contactPerson)} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
                <Field label="Job Title"><input className="input" value={s(f.contactTitle)} onChange={(e) => set('contactTitle', e.target.value)} /></Field>
                <Field label="Mobile"><input className="input" value={s(f.mobile)} onChange={(e) => set('mobile', e.target.value)} /></Field>
                <Field label="Office Phone"><input className="input" value={s(f.officePhone)} onChange={(e) => set('officePhone', e.target.value)} /></Field>
                <Field label="Extension"><input className="input" value={s(f.extension)} onChange={(e) => set('extension', e.target.value)} /></Field>
                <Field label="Email">
                  <input className="input" value={s(f.email)} onChange={(e) => set('email', e.target.value)} />
                  {emailInvalid && <p className="text-xs text-red-500 mt-1">Invalid email format</p>}
                </Field>
                <Field label="WhatsApp"><input className="input" value={s(f.whatsapp)} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
                <Field label="Preferred Communication"><select className="input" value={s(f.preferredComm)} onChange={(e) => set('preferredComm', e.target.value)}><option value="">—</option>{COMM_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
                <Field span={2} label="Short Address (single line)"><input className="input" value={s(f.address)} onChange={(e) => set('address', e.target.value)} /></Field>
              </Grid>
            </Section>
          </div>
        )}

        {tab === 'Contacts' && (
          <ChildList title="Additional Contacts" rows={contacts} onAdd={() => setContacts([...contacts, emptyContact()])}
            onRemove={(i) => setContacts(contacts.filter((_, x) => x !== i))}
            onChange={(i, patch) => setContacts(contacts.map((c, x) => (x === i ? { ...c, ...patch } : c)))}
            render={(c, i, upd) => (
              <Grid>
                <Field label="Name" required><input className="input" value={c.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                <Field label="Position"><input className="input" value={c.position} onChange={(e) => upd({ position: e.target.value })} /></Field>
                <Field label="Department"><input className="input" value={c.department} onChange={(e) => upd({ department: e.target.value })} /></Field>
                <Field label="Mobile"><input className="input" value={c.mobile} onChange={(e) => upd({ mobile: e.target.value })} /></Field>
                <Field label="Phone"><input className="input" value={c.phone} onChange={(e) => upd({ phone: e.target.value })} /></Field>
                <Field label="Email"><input className="input" value={c.email} onChange={(e) => upd({ email: e.target.value })} /></Field>
                <Field span={2} label="Remarks"><input className="input" value={c.remarks} onChange={(e) => upd({ remarks: e.target.value })} /></Field>
              </Grid>
            )}
          />
        )}

        {tab === 'Addresses' && (
          <ChildList title="Business Addresses" rows={addresses} onAdd={() => setAddresses([...addresses, emptyAddress()])}
            onRemove={(i) => setAddresses(addresses.filter((_, x) => x !== i))}
            onChange={(i, patch) => setAddresses(addresses.map((a, x) => (x === i ? { ...a, ...patch } : a)))}
            render={(a, i, upd) => (
              <Grid>
                <Field label="Type"><select className="input" value={a.type} onChange={(e) => upd({ type: e.target.value })}>{ADDRESS_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Primary?"><label className="flex items-center gap-2 h-9 text-sm"><input type="checkbox" checked={a.isPrimary} onChange={(e) => upd({ isPrimary: e.target.checked })} /> Mark as primary</label></Field>
                <Field span={2} label="Address Line 1"><input className="input" value={a.line1} onChange={(e) => upd({ line1: e.target.value })} /></Field>
                <Field span={2} label="Address Line 2"><input className="input" value={a.line2} onChange={(e) => upd({ line2: e.target.value })} /></Field>
                <Field label="City"><input className="input" value={a.city} onChange={(e) => upd({ city: e.target.value })} /></Field>
                <Field label="State"><input className="input" value={a.state} onChange={(e) => upd({ state: e.target.value })} /></Field>
                <Field label="Postal Code"><input className="input" value={a.postalCode} onChange={(e) => upd({ postalCode: e.target.value })} /></Field>
                <Field label="Country"><input className="input" value={a.country} onChange={(e) => upd({ country: e.target.value })} /></Field>
              </Grid>
            )}
          />
        )}

        {tab === 'Finance' && (
          <Section title="Financial Terms">
            <Grid>
              <Field label="Payment Terms (with us)"><input className="input" placeholder="NET 30 / COD" value={s(f.paymentTerm)} onChange={(e) => set('paymentTerm', e.target.value)} /></Field>
              <Field label="Currency"><select className="input" value={s(f.currency)} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Credit Limit (they give us)"><input className="input text-right" type="number" step="0.01" min="0" value={n(f.creditLimit)} onChange={(e) => set('creditLimit', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="Tax Type"><input className="input" placeholder="SST / GST / EXEMPT" value={s(f.taxType)} onChange={(e) => set('taxType', e.target.value)} /></Field>
              <Field label="Opening Balance"><input className="input text-right" type="number" step="0.01" value={n(f.openingBalance)} onChange={(e) => set('openingBalance', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="Opening Balance Date"><input className="input" type="date" value={s(f.openingBalanceDate)} onChange={(e) => set('openingBalanceDate', e.target.value)} /></Field>
              <Field label="Tax Exempt"><label className="flex items-center gap-2 h-9 text-sm"><input type="checkbox" checked={!!f.taxExempt} onChange={(e) => set('taxExempt', e.target.checked)} /> SST-exempt</label></Field>
            </Grid>
          </Section>
        )}

        {tab === 'Procurement' && (
          <div className="space-y-4">
            <Section title="Procurement & Operations">
              <Grid>
                <Field span={2} label="Assigned Buyer">
                  <SearchableSelect value={s(f.assignedBuyerId)} onChange={(v) => set('assignedBuyerId', v)} placeholder="Search buyer…"
                    options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))} />
                </Field>
                <Field label="Preferred Mode"><select className="input" value={s(f.preferredMode)} onChange={(e) => set('preferredMode', e.target.value)}><option value="">—</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select></Field>
                <Field label="Lead Time (days)"><input className="input text-right" type="number" min="0" value={n(f.leadTimeDays)} onChange={(e) => set('leadTimeDays', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                <Field label="Delivery Terms"><input className="input" placeholder="FOB / CIF / SLA" value={s(f.deliveryTerms)} onChange={(e) => set('deliveryTerms', e.target.value)} /></Field>
                <Field label="Min Order Value"><input className="input text-right" type="number" step="0.01" min="0" value={n(f.minOrderValue)} onChange={(e) => set('minOrderValue', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              </Grid>
            </Section>
            <Section title="Accounting">
              <Grid>
                <Field label="AP Account"><input className="input" value={s(f.apAccount)} onChange={(e) => set('apAccount', e.target.value)} /></Field>
                <Field label="Vendor Account Code"><input className="input" value={s(f.vendorAccountCode)} onChange={(e) => set('vendorAccountCode', e.target.value)} /></Field>
                <Field label="Tax Category"><input className="input" value={s(f.taxCategory)} onChange={(e) => set('taxCategory', e.target.value)} /></Field>
                <Field span={2} label="Finance Remarks"><input className="input" value={s(f.financeRemarks)} onChange={(e) => set('financeRemarks', e.target.value)} /></Field>
              </Grid>
            </Section>
          </div>
        )}

        {tab === 'Compliance' && (
          <Section title="Compliance & Contract Lifecycle">
            <Grid>
              <Field label="Status"><select className="input" value={s(f.status)} onChange={(e) => set('status', e.target.value)}><option>ACTIVE</option><option>INACTIVE</option></select></Field>
              <Field label="Preferred Vendor"><label className="flex items-center gap-2 h-9 text-sm"><input type="checkbox" checked={!!f.isPreferred} onChange={(e) => set('isPreferred', e.target.checked)} /> Preferred</label></Field>
              <Field label="Onboarded Date"><input className="input" type="date" value={s(f.onboardedDate)} onChange={(e) => set('onboardedDate', e.target.value)} /></Field>
              <Field label="License No."><input className="input" value={s(f.licenseNo)} onChange={(e) => set('licenseNo', e.target.value)} /></Field>
              <Field label="Contract Start"><input className="input" type="date" value={s(f.contractStart)} onChange={(e) => set('contractStart', e.target.value)} /></Field>
              <Field label="Contract End"><input className="input" type="date" value={s(f.contractEnd)} onChange={(e) => set('contractEnd', e.target.value)} /></Field>
              <Field label="Insurance Expiry"><input className="input" type="date" value={s(f.insuranceExpiry)} onChange={(e) => set('insuranceExpiry', e.target.value)} /></Field>
              <Field label="Next Review Date"><input className="input" type="date" value={s(f.nextReviewDate)} onChange={(e) => set('nextReviewDate', e.target.value)} /></Field>
            </Grid>
          </Section>
        )}

        {tab === 'Docs & Bank' && (
          <div className="space-y-4">
            <ChildList title="Documents" rows={docs} onAdd={() => setDocs([...docs, emptyDoc()])}
              onRemove={(i) => setDocs(docs.filter((_, x) => x !== i))}
              onChange={(i, patch) => setDocs(docs.map((x, ix) => (ix === i ? { ...x, ...patch } : x)))}
              render={(x, i, upd) => (
                <Grid>
                  <Field label="Document Name" required><input className="input" value={x.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                  <Field label="Category"><select className="input" value={x.category} onChange={(e) => upd({ category: e.target.value })}><option value="">—</option>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
                  <Field span={2} label="Link / Reference"><input className="input" placeholder="https://… or file reference" value={x.link} onChange={(e) => upd({ link: e.target.value })} /></Field>
                  <Field span={2} label="Notes"><input className="input" value={x.notes} onChange={(e) => upd({ notes: e.target.value })} /></Field>
                </Grid>
              )}
            />
            <ChildList title="Bank Accounts (we remit to)" rows={banks} onAdd={() => setBanks([...banks, emptyBank()])}
              onRemove={(i) => setBanks(banks.filter((_, x) => x !== i))}
              onChange={(i, patch) => setBanks(banks.map((b, x) => (x === i ? { ...b, ...patch } : b)))}
              render={(b, i, upd) => (
                <Grid>
                  <Field label="Bank Name"><input className="input" value={b.bankName} onChange={(e) => upd({ bankName: e.target.value })} /></Field>
                  <Field label="Account Name"><input className="input" value={b.accountName} onChange={(e) => upd({ accountName: e.target.value })} /></Field>
                  <Field label="Account Number"><input className="input" value={b.accountNumber} onChange={(e) => upd({ accountNumber: e.target.value })} /></Field>
                  <Field label="SWIFT"><input className="input" value={b.swift} onChange={(e) => upd({ swift: e.target.value })} /></Field>
                  <Field span={2} label="Bank Address"><input className="input" value={b.bankAddress} onChange={(e) => upd({ bankAddress: e.target.value })} /></Field>
                </Grid>
              )}
            />
          </div>
        )}

        {tab === 'Notes' && (
          <Section title="Internal Notes & Flags">
            <Grid>
              <Field span={2} label="General Notes"><textarea className="input" rows={3} value={s(f.notes)} onChange={(e) => set('notes', e.target.value)} /></Field>
              <Field span={2} label="Warnings"><textarea className="input" rows={2} value={s(f.warnings)} onChange={(e) => set('warnings', e.target.value)} /></Field>
              <Field span={2} label="Flags">
                <div className="flex gap-4 h-9 items-center text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.isPreferred} onChange={(e) => set('isPreferred', e.target.checked)} /> Preferred</label>
                  <label className="flex items-center gap-2 text-red-600"><input type="checkbox" checked={!!f.blacklist} onChange={(e) => set('blacklist', e.target.checked)} /> Blacklist</label>
                </div>
              </Field>
            </Grid>
          </Section>
        )}

        <ErrorText error={save.error} />
        <div className="flex items-center gap-3 pt-1">
          <p className="text-xs text-gray-400">{vendor ? `Editing ${vendor.code}` : 'Vendor code is auto-generated on save.'}</p>
          <button className="btn-primary ml-auto justify-center" disabled={!f.name || emailInvalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save Vendor'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── small presentational helpers ────────────────────────────────────
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? '' : String(v));
function stripBlank<T extends object>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) out[k] = v;
  return out as Partial<T>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</div>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, required, span, children }: { label: string; required?: boolean; span?: number; children: React.ReactNode }) {
  return (
    <div className={span === 2 ? 'md:col-span-2' : ''}>
      <label className="label">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}
function ChildList<T>({ title, rows, onAdd, onRemove, onChange, render }: {
  title: string; rows: T[]; onAdd: () => void; onRemove: (i: number) => void;
  onChange: (i: number, patch: Partial<T>) => void;
  render: (row: T, i: number, upd: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title} ({rows.length})</div>
        <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onAdd}><Plus size={13} /> Add</button>
      </div>
      {rows.length === 0 && <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-lg">None yet — click Add.</p>}
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="card !p-3 relative">
            <button type="button" className="absolute top-2 right-2 text-red-400 hover:text-red-600" onClick={() => onRemove(i)}><Trash2 size={14} /></button>
            {render(row, i, (patch) => onChange(i, patch))}
          </div>
        ))}
      </div>
    </div>
  );
}
