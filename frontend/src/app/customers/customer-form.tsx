'use client';

/**
 * Customer master profile — a tabbed, ERP-grade New/Edit form.
 * Scalar fields plus dynamic child collections (contacts, addresses, bank
 * accounts, documents) that map 1:1 to the backend nested-write API. Uses
 * plain controlled state (not react-hook-form) because the dynamic arrays are
 * far simpler to manage that way, matching the quotation/invoice builders.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, ErrorText, SearchableSelect } from '@/components/ui';
import { api } from '@/lib/api';

const TABS = ['General', 'Contacts', 'Addresses', 'Finance', 'Sales & Ops', 'CRM', 'Docs & Bank', 'Notes'] as const;
type Tab = typeof TABS[number];

const CURRENCIES = ['MYR', 'USD', 'SGD', 'EUR', 'CNY'];
const ADDRESS_TYPES = ['REGISTERED', 'BILLING', 'SHIPPING', 'WAREHOUSE'];
const COMM_METHODS = ['EMAIL', 'PHONE', 'WHATSAPP', 'SMS'];
const LEAD_STATUSES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];
const DOC_CATEGORIES = ['Business Registration', 'Tax Certificate', 'Company Profile', 'Credit Application', 'Signed Agreement', 'Other'];

interface Contact { name: string; position: string; department: string; mobile: string; phone: string; email: string; remarks: string }
interface Address { type: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; isPrimary: boolean }
interface BankAccount { bankName: string; accountName: string; accountNumber: string; swift: string; bankAddress: string }
interface DocRow { name: string; category: string; link: string; notes: string }

// A single flat record of every scalar field; dates are yyyy-mm-dd strings.
type Scalars = Record<string, string | number | boolean | null>;

const emptyContact = (): Contact => ({ name: '', position: '', department: '', mobile: '', phone: '', email: '', remarks: '' });
const emptyAddress = (t = 'BILLING'): Address => ({ type: t, line1: '', line2: '', city: '', state: '', postalCode: '', country: 'Malaysia', isPrimary: false });
const emptyBank = (): BankAccount => ({ bankName: '', accountName: '', accountNumber: '', swift: '', bankAddress: '' });
const emptyDoc = (): DocRow => ({ name: '', category: '', link: '', notes: '' });

const d10 = (s?: string | null) => (s ? String(s).slice(0, 10) : '');

export function CustomerModal({ customer, onClose }: { customer: { id: string; code: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('General');

  // Full record (with children) for edit; new starts from defaults.
  const { data: detail } = useQuery({
    queryKey: ['customer-full', customer?.id],
    queryFn: () => api<Record<string, unknown>>(`/customers/${customer!.id}`),
    enabled: !!customer,
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; fullName: string }[]>('/users').catch(() => []) });

  const [f, setF] = useState<Scalars>({
    companyName: '', customerType: 'COMPANY', status: 'ACTIVE', priority: 3, currency: 'MYR',
    receivePromotions: true, receiveStatementsByEmail: true, receiveInvoiceByEmail: true,
    taxExempt: false, creditHold: false, blacklist: false, vip: false,
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  if (customer && detail && !hydrated) {
    const d = detail as Record<string, unknown>;
    const num = (v: unknown) => (v == null ? null : Number(v));
    setF({
      ...f,
      companyName: (d.companyName as string) ?? '', customerType: (d.customerType as string) ?? 'COMPANY',
      registrationNo: (d.registrationNo as string) ?? '', taxId: (d.taxId as string) ?? '', industry: (d.industry as string) ?? '',
      website: (d.website as string) ?? '', customerCategory: (d.customerCategory as string) ?? '', salesTerritory: (d.salesTerritory as string) ?? '',
      leadSource: (d.leadSource as string) ?? '',
      pic: (d.pic as string) ?? '', contactTitle: (d.contactTitle as string) ?? '', mobile: (d.mobile as string) ?? '',
      phone: (d.phone as string) ?? '', officePhone: (d.officePhone as string) ?? '', extension: (d.extension as string) ?? '',
      email: (d.email as string) ?? '', whatsapp: (d.whatsapp as string) ?? '', preferredComm: (d.preferredComm as string) ?? '',
      address: (d.address as string) ?? '',
      paymentTerm: (d.paymentTerm as string) ?? '', creditLimit: num(d.creditLimit), outstandingLimit: num(d.outstandingLimit),
      currency: (d.currency as string) ?? 'MYR', priceLevel: (d.priceLevel as string) ?? '', taxType: (d.taxType as string) ?? '',
      taxExempt: !!d.taxExempt, creditHold: !!d.creditHold, openingBalance: num(d.openingBalance), openingBalanceDate: d10(d.openingBalanceDate as string),
      assignedSalespersonId: (d.assignedSalespersonId as string) ?? '', salesTeam: (d.salesTeam as string) ?? '',
      priority: (d.priority as number) ?? 3, discountGroup: (d.discountGroup as string) ?? '', defaultDiscountPct: num(d.defaultDiscountPct),
      commissionGroup: (d.commissionGroup as string) ?? '', defaultWarehouse: (d.defaultWarehouse as string) ?? '',
      preferredDeliveryMethod: (d.preferredDeliveryMethod as string) ?? '', preferredShippingCompany: (d.preferredShippingCompany as string) ?? '',
      arAccount: (d.arAccount as string) ?? '', customerAccountCode: (d.customerAccountCode as string) ?? '',
      taxCategory: (d.taxCategory as string) ?? '', financeRemarks: (d.financeRemarks as string) ?? '',
      deliveryInstructions: (d.deliveryInstructions as string) ?? '', receivingHours: (d.receivingHours as string) ?? '',
      loadingBayNotes: (d.loadingBayNotes as string) ?? '', preferredCourier: (d.preferredCourier as string) ?? '', shippingNotes: (d.shippingNotes as string) ?? '',
      status: (d.status as string) ?? 'ACTIVE', leadStatus: (d.leadStatus as string) ?? '',
      firstContactDate: d10(d.firstContactDate as string), customerSince: d10(d.customerSince as string),
      lastContactDate: d10(d.lastContactDate as string), lastSalesDate: d10(d.lastSalesDate as string), nextFollowUp: d10(d.nextFollowUp as string),
      birthday: d10(d.birthday as string), companyAnniversary: d10(d.companyAnniversary as string),
      preferredLanguage: (d.preferredLanguage as string) ?? '', timeZone: (d.timeZone as string) ?? '',
      receivePromotions: !!d.receivePromotions, receiveStatementsByEmail: !!d.receiveStatementsByEmail, receiveInvoiceByEmail: !!d.receiveInvoiceByEmail,
      notes: (d.notes as string) ?? '', creditNotesInternal: (d.creditNotesInternal as string) ?? '', collectionNotes: (d.collectionNotes as string) ?? '',
      customerWarnings: (d.customerWarnings as string) ?? '', blacklist: !!d.blacklist, vip: !!d.vip,
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
      // Drop blank strings so optional fields don't fail email/date validators.
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) {
        if (v === '' || v === null) continue;
        clean[k] = v;
      }
      clean.companyName = f.companyName; // always send (required)
      const body = {
        ...clean,
        contacts: contacts.filter((c) => c.name.trim()).map((c) => stripBlank(c)),
        addresses: addresses.filter((a) => a.line1.trim() || a.city.trim()).map((a) => stripBlank(a)),
        bankAccounts: banks.filter((b) => b.bankName.trim() || b.accountNumber.trim()).map((b) => stripBlank(b)),
        documents: docs.filter((x) => x.name.trim()).map((x) => stripBlank(x)),
      };
      return customer
        ? api(`/customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/customers', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); },
  });

  const emailInvalid = !!f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email));

  return (
    <Modal title={customer ? `Edit ${customer.code}` : 'New Customer'} onClose={onClose} size="xl">
      <div className="space-y-4">
        {/* Tabs */}
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
                <Field span={2} label="Company Name" required><input className="input" value={s(f.companyName)} onChange={(e) => set('companyName', e.target.value)} /></Field>
                <Field label="Customer Type"><select className="input" value={s(f.customerType)} onChange={(e) => set('customerType', e.target.value)}><option>COMPANY</option><option>INDIVIDUAL</option></select></Field>
                <Field label="Industry"><input className="input" value={s(f.industry)} onChange={(e) => set('industry', e.target.value)} /></Field>
                <Field label="Registration No."><input className="input" placeholder="SSM / Business Reg." value={s(f.registrationNo)} onChange={(e) => set('registrationNo', e.target.value)} /></Field>
                <Field label="Tax ID (GST/SST)"><input className="input" value={s(f.taxId)} onChange={(e) => set('taxId', e.target.value)} /></Field>
                <Field label="Website"><input className="input" placeholder="www.example.com" value={s(f.website)} onChange={(e) => set('website', e.target.value)} /></Field>
                <Field label="Customer Category"><input className="input" placeholder="Wholesale / Retail…" value={s(f.customerCategory)} onChange={(e) => set('customerCategory', e.target.value)} /></Field>
                <Field label="Sales Territory"><input className="input" value={s(f.salesTerritory)} onChange={(e) => set('salesTerritory', e.target.value)} /></Field>
                <Field label="Lead Source"><input className="input" placeholder="Referral / Website / Exhibition" value={s(f.leadSource)} onChange={(e) => set('leadSource', e.target.value)} /></Field>
              </Grid>
            </Section>
            <Section title="Primary Contact">
              <Grid>
                <Field label="Contact Person"><input className="input" value={s(f.pic)} onChange={(e) => set('pic', e.target.value)} /></Field>
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
                <Field span={2} label="Short Address (single line, prints on documents)"><input className="input" value={s(f.address)} onChange={(e) => set('address', e.target.value)} /></Field>
              </Grid>
            </Section>
          </div>
        )}

        {tab === 'Contacts' && (
          <ChildList
            title="Additional Contacts" rows={contacts} onAdd={() => setContacts([...contacts, emptyContact()])}
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
          <ChildList
            title="Business Addresses" rows={addresses} onAdd={() => setAddresses([...addresses, emptyAddress()])}
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
          <Section title="Financial Information">
            <Grid>
              <Field label="Payment Terms"><input className="input" placeholder="NET 30 / CASH" value={s(f.paymentTerm)} onChange={(e) => set('paymentTerm', e.target.value)} /></Field>
              <Field label="Currency"><select className="input" value={s(f.currency)} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Credit Limit"><input className="input text-right" type="number" step="0.01" min="0" value={n(f.creditLimit)} onChange={(e) => set('creditLimit', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="Outstanding Limit"><input className="input text-right" type="number" step="0.01" min="0" value={n(f.outstandingLimit)} onChange={(e) => set('outstandingLimit', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="Price Level"><input className="input" value={s(f.priceLevel)} onChange={(e) => set('priceLevel', e.target.value)} /></Field>
              <Field label="Tax Type"><input className="input" placeholder="SST / GST / EXEMPT" value={s(f.taxType)} onChange={(e) => set('taxType', e.target.value)} /></Field>
              <Field label="Opening Balance"><input className="input text-right" type="number" step="0.01" value={n(f.openingBalance)} onChange={(e) => set('openingBalance', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="Opening Balance Date"><input className="input" type="date" value={s(f.openingBalanceDate)} onChange={(e) => set('openingBalanceDate', e.target.value)} /></Field>
              <Field label="Tax Exempt"><label className="flex items-center gap-2 h-9 text-sm"><input type="checkbox" checked={!!f.taxExempt} onChange={(e) => set('taxExempt', e.target.checked)} /> SST-exempt</label></Field>
              <Field label="Credit Hold"><label className="flex items-center gap-2 h-9 text-sm"><input type="checkbox" checked={!!f.creditHold} onChange={(e) => set('creditHold', e.target.checked)} /> Block new orders</label></Field>
            </Grid>
          </Section>
        )}

        {tab === 'Sales & Ops' && (
          <div className="space-y-4">
            <Section title="Sales Information">
              <Grid>
                <Field span={2} label="Assigned Salesperson">
                  <SearchableSelect value={s(f.assignedSalespersonId)} onChange={(v) => set('assignedSalespersonId', v)} placeholder="Search salesperson…"
                    options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))} />
                </Field>
                <Field label="Sales Team"><input className="input" value={s(f.salesTeam)} onChange={(e) => set('salesTeam', e.target.value)} /></Field>
                <Field label="Priority (1 = top)"><input className="input" type="number" min={1} max={5} value={n(f.priority)} onChange={(e) => set('priority', Number(e.target.value))} /></Field>
                <Field label="Discount Group"><input className="input" value={s(f.discountGroup)} onChange={(e) => set('discountGroup', e.target.value)} /></Field>
                <Field label="Default Discount %"><input className="input text-right" type="number" step="0.01" min="0" value={n(f.defaultDiscountPct)} onChange={(e) => set('defaultDiscountPct', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                <Field label="Commission Group"><input className="input" value={s(f.commissionGroup)} onChange={(e) => set('commissionGroup', e.target.value)} /></Field>
                <Field label="Default Warehouse"><input className="input" value={s(f.defaultWarehouse)} onChange={(e) => set('defaultWarehouse', e.target.value)} /></Field>
                <Field label="Preferred Delivery Method"><input className="input" value={s(f.preferredDeliveryMethod)} onChange={(e) => set('preferredDeliveryMethod', e.target.value)} /></Field>
                <Field label="Preferred Shipping Company"><input className="input" value={s(f.preferredShippingCompany)} onChange={(e) => set('preferredShippingCompany', e.target.value)} /></Field>
              </Grid>
            </Section>
            <Section title="Accounting">
              <Grid>
                <Field label="AR Account"><input className="input" value={s(f.arAccount)} onChange={(e) => set('arAccount', e.target.value)} /></Field>
                <Field label="Customer Account Code"><input className="input" value={s(f.customerAccountCode)} onChange={(e) => set('customerAccountCode', e.target.value)} /></Field>
                <Field label="Tax Category"><input className="input" value={s(f.taxCategory)} onChange={(e) => set('taxCategory', e.target.value)} /></Field>
                <Field span={2} label="Finance Remarks"><input className="input" value={s(f.financeRemarks)} onChange={(e) => set('financeRemarks', e.target.value)} /></Field>
              </Grid>
            </Section>
            <Section title="Shipping">
              <Grid>
                <Field span={2} label="Delivery Instructions"><input className="input" value={s(f.deliveryInstructions)} onChange={(e) => set('deliveryInstructions', e.target.value)} /></Field>
                <Field label="Receiving Hours"><input className="input" placeholder="Mon–Fri 9am–5pm" value={s(f.receivingHours)} onChange={(e) => set('receivingHours', e.target.value)} /></Field>
                <Field label="Preferred Courier"><input className="input" value={s(f.preferredCourier)} onChange={(e) => set('preferredCourier', e.target.value)} /></Field>
                <Field span={2} label="Loading Bay Notes"><input className="input" value={s(f.loadingBayNotes)} onChange={(e) => set('loadingBayNotes', e.target.value)} /></Field>
                <Field span={2} label="Shipping Notes"><input className="input" value={s(f.shippingNotes)} onChange={(e) => set('shippingNotes', e.target.value)} /></Field>
              </Grid>
            </Section>
          </div>
        )}

        {tab === 'CRM' && (
          <div className="space-y-4">
            <Section title="CRM & Lifecycle">
              <Grid>
                <Field label="Account Status"><select className="input" value={s(f.status)} onChange={(e) => set('status', e.target.value)}><option>ACTIVE</option><option>INACTIVE</option></select></Field>
                <Field label="Lead Status"><select className="input" value={s(f.leadStatus)} onChange={(e) => set('leadStatus', e.target.value)}><option value="">—</option>{LEAD_STATUSES.map((l) => <option key={l}>{l}</option>)}</select></Field>
                <Field label="First Contact Date"><input className="input" type="date" value={s(f.firstContactDate)} onChange={(e) => set('firstContactDate', e.target.value)} /></Field>
                <Field label="Customer Since"><input className="input" type="date" value={s(f.customerSince)} onChange={(e) => set('customerSince', e.target.value)} /></Field>
                <Field label="Last Contact Date"><input className="input" type="date" value={s(f.lastContactDate)} onChange={(e) => set('lastContactDate', e.target.value)} /></Field>
                <Field label="Last Sales Date"><input className="input" type="date" value={s(f.lastSalesDate)} onChange={(e) => set('lastSalesDate', e.target.value)} /></Field>
                <Field label="Next Follow-up"><input className="input" type="date" value={s(f.nextFollowUp)} onChange={(e) => set('nextFollowUp', e.target.value)} /></Field>
                <Field label="Birthday (individual)"><input className="input" type="date" value={s(f.birthday)} onChange={(e) => set('birthday', e.target.value)} /></Field>
                <Field label="Company Anniversary"><input className="input" type="date" value={s(f.companyAnniversary)} onChange={(e) => set('companyAnniversary', e.target.value)} /></Field>
              </Grid>
            </Section>
            <Section title="Preferences">
              <Grid>
                <Field label="Preferred Language"><input className="input" value={s(f.preferredLanguage)} onChange={(e) => set('preferredLanguage', e.target.value)} /></Field>
                <Field label="Time Zone"><input className="input" placeholder="Asia/Kuala_Lumpur" value={s(f.timeZone)} onChange={(e) => set('timeZone', e.target.value)} /></Field>
                <Field span={2} label="Email preferences">
                  <div className="flex flex-wrap gap-4 h-9 items-center text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.receivePromotions} onChange={(e) => set('receivePromotions', e.target.checked)} /> Promotions</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.receiveStatementsByEmail} onChange={(e) => set('receiveStatementsByEmail', e.target.checked)} /> Statements by email</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.receiveInvoiceByEmail} onChange={(e) => set('receiveInvoiceByEmail', e.target.checked)} /> Invoice by email</label>
                  </div>
                </Field>
              </Grid>
            </Section>
          </div>
        )}

        {tab === 'Docs & Bank' && (
          <div className="space-y-4">
            <ChildList
              title="Documents" rows={docs} onAdd={() => setDocs([...docs, emptyDoc()])}
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
            <ChildList
              title="Bank Accounts" rows={banks} onAdd={() => setBanks([...banks, emptyBank()])}
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
              <Field span={2} label="General Notes"><textarea className="input" rows={2} value={s(f.notes)} onChange={(e) => set('notes', e.target.value)} /></Field>
              <Field span={2} label="Credit / Finance Notes"><textarea className="input" rows={2} value={s(f.creditNotesInternal)} onChange={(e) => set('creditNotesInternal', e.target.value)} /></Field>
              <Field span={2} label="Collection Notes"><textarea className="input" rows={2} value={s(f.collectionNotes)} onChange={(e) => set('collectionNotes', e.target.value)} /></Field>
              <Field span={2} label="Customer Warnings"><textarea className="input" rows={2} value={s(f.customerWarnings)} onChange={(e) => set('customerWarnings', e.target.value)} /></Field>
              <Field span={2} label="Flags">
                <div className="flex gap-4 h-9 items-center text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.vip} onChange={(e) => set('vip', e.target.checked)} /> VIP customer</label>
                  <label className="flex items-center gap-2 text-red-600"><input type="checkbox" checked={!!f.blacklist} onChange={(e) => set('blacklist', e.target.checked)} /> Blacklist</label>
                </div>
              </Field>
            </Grid>
          </Section>
        )}

        <ErrorText error={save.error} />
        <div className="flex items-center gap-3 pt-1">
          <p className="text-xs text-gray-400">{customer ? `Editing ${customer.code}` : 'Customer code is auto-generated on save.'}</p>
          <button className="btn-primary ml-auto justify-center" disabled={!f.companyName || emailInvalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save Customer'}
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
