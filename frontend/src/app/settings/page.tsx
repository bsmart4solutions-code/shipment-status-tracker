'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shell } from '@/components/shell';
import { Card, ErrorText, Modal, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';

interface User { id: string; email: string; fullName: string; phone: string | null; isActive: boolean; roleId: string; role: { name: string } }
interface Role { id: string; name: string; permissions: { permission: { id: string; code: string } }[]; _count: { users: number } }
interface Permission { id: string; code: string; label: string }
interface Setting { key: string; value: unknown }

export default function SettingsPage() {
  const canUsers = hasPermission('users.read');
  const canSettings = hasPermission('settings.read');

  return (
    <Shell title="Settings">
      <div className="space-y-6">
        {canSettings && <CompanyProfileSection />}
        {canUsers && <UsersSection />}
        {canUsers && <RolesSection />}
        {canSettings && <SystemSettingsSection />}
      </div>
    </Shell>
  );
}

interface CompanyProfile {
  name: string; logoDataUrl: string | null; addressLines: string[]; tel: string; fax: string;
  email: string; website: string; coNo: string; sstId: string;
  bank: { bank: string; branch: string; swift: string; accounts: { currency: string; number: string }[]; payableTo: string };
}

/** Company letterhead + bank details printed on quotations and invoices. */
function CompanyProfileSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['company-profile'], queryFn: () => api<CompanyProfile>('/settings/company') });
  const [form, setForm] = useState<CompanyProfile | null>(null);
  const [logoError, setLogoError] = useState('');
  const canWrite = hasPermission('settings.write');

  // Seed the form once the profile loads.
  const model = form ?? data ?? null;
  if (data && !form) setForm(data);

  const save = useMutation({
    mutationFn: () => api('/settings/company', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-profile'] }),
  });

  const set = (k: keyof CompanyProfile, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setBank = (k: string, v: unknown) => setForm((f) => (f ? { ...f, bank: { ...f.bank, [k]: v } } : f));

  function onLogoFile(file: File) {
    setLogoError('');
    if (file.size > 400_000) { setLogoError('Logo too large — please use an image under 400 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => set('logoDataUrl', reader.result as string);
    reader.readAsDataURL(file);
  }

  if (!model) return <Card><h3 className="font-semibold">Company Profile</h3><p className="text-sm text-gray-400 mt-2">Loading…</p></Card>;

  return (
    <Card>
      <div className="flex justify-between items-center mb-1">
        <h3 className="font-semibold">Company Profile</h3>
        {canWrite && <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save Profile'}</button>}
      </div>
      <p className="text-xs text-gray-500 mb-4">Printed as the letterhead and bank details on every quotation and invoice.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Logo */}
        <div className="md:col-span-2 flex items-center gap-4">
          <div className="w-28 h-20 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-800/50">
            {model.logoDataUrl ? <img src={model.logoDataUrl} alt="logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-gray-400">No logo</span>}
          </div>
          <div>
            <label className="label">Company Logo</label>
            <input type="file" accept="image/*" disabled={!canWrite} onChange={(e) => e.target.files?.[0] && onLogoFile(e.target.files[0])} className="text-sm" />
            {model.logoDataUrl && canWrite && <button className="text-red-500 text-xs hover:underline ml-2" onClick={() => set('logoDataUrl', null)}>Remove</button>}
            {logoError && <p className="text-xs text-red-500 mt-1">{logoError}</p>}
            <p className="text-xs text-gray-400 mt-1">PNG/JPG, under 400 KB. Stored in the database (no external hosting).</p>
          </div>
        </div>

        <div className="md:col-span-2"><label className="label">Company Name</label><input className="input" value={model.name} disabled={!canWrite} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="md:col-span-2"><label className="label">Address (one line per row)</label>
          <textarea className="input" rows={2} disabled={!canWrite} value={model.addressLines.join('\n')} onChange={(e) => set('addressLines', e.target.value.split('\n'))} /></div>
        <div><label className="label">Tel</label><input className="input" value={model.tel} disabled={!canWrite} onChange={(e) => set('tel', e.target.value)} /></div>
        <div><label className="label">Fax</label><input className="input" value={model.fax} disabled={!canWrite} onChange={(e) => set('fax', e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" value={model.email} disabled={!canWrite} onChange={(e) => set('email', e.target.value)} /></div>
        <div><label className="label">Website</label><input className="input" placeholder="www.example.com" value={model.website} disabled={!canWrite} onChange={(e) => set('website', e.target.value)} /></div>
        <div><label className="label">Company Reg. No (Co. No / SSM)</label><input className="input" value={model.coNo} disabled={!canWrite} onChange={(e) => set('coNo', e.target.value)} /></div>
        <div><label className="label">SST / Tax ID</label><input className="input" value={model.sstId} disabled={!canWrite} onChange={(e) => set('sstId', e.target.value)} /></div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Bank Details (printed on invoices)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="label">Bank</label><input className="input" value={model.bank.bank} disabled={!canWrite} onChange={(e) => setBank('bank', e.target.value)} /></div>
          <div><label className="label">Branch</label><input className="input" value={model.bank.branch} disabled={!canWrite} onChange={(e) => setBank('branch', e.target.value)} /></div>
          <div><label className="label">SWIFT Code</label><input className="input" value={model.bank.swift} disabled={!canWrite} onChange={(e) => setBank('swift', e.target.value)} /></div>
          <div><label className="label">Cheques Payable To</label><input className="input" value={model.bank.payableTo} disabled={!canWrite} onChange={(e) => setBank('payableTo', e.target.value)} /></div>
        </div>
        <div className="mt-3">
          <label className="label">Bank Accounts</label>
          {model.bank.accounts.map((a, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className="input max-w-[110px]" placeholder="MYR" value={a.currency} disabled={!canWrite}
                onChange={(e) => setBank('accounts', model.bank.accounts.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))} />
              <input className="input" placeholder="Account number" value={a.number} disabled={!canWrite}
                onChange={(e) => setBank('accounts', model.bank.accounts.map((x, j) => j === i ? { ...x, number: e.target.value } : x))} />
              {canWrite && <button className="btn-ghost !px-3" onClick={() => setBank('accounts', model.bank.accounts.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          {canWrite && <button className="text-primary text-sm hover:underline" onClick={() => setBank('accounts', [...model.bank.accounts, { currency: '', number: '' }])}>+ Add account</button>}
        </div>
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });

  const [editing, setEditing] = useState<User | null>(null);
  const toggle = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !u.isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const canWrite = hasPermission('users.write');

  return (
    <Card>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Users</h3>
        {canWrite && <button className="btn-primary" onClick={() => setAdding(true)}>Add User</button>}
      </div>
      <p className="text-xs text-gray-500 mb-3">A salesperson&apos;s phone and email print on the quotations they own — set them here.</p>
      <Table head={['Name', 'Email', 'Phone', 'Role', 'Status', '']} empty={users?.length === 0}>
        {users?.map((u) => (
          <tr key={u.id}>
            <td className="td font-medium">{u.fullName}</td>
            <td className="td text-gray-500">{u.email}</td>
            <td className="td text-gray-500">{u.phone || '-'}</td>
            <td className="td"><span className="badge bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">{u.role.name}</span></td>
            <td className="td">{u.isActive ? '✓ Active' : '✗ Disabled'}</td>
            <td className="td">
              {canWrite && (
                <div className="flex gap-3">
                  <button className="text-primary hover:underline text-sm" onClick={() => setEditing(u)}>Edit</button>
                  <button className="text-primary hover:underline text-sm" onClick={() => toggle.mutate(u)}>
                    {u.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {adding && roles && <AddUserModal roles={roles} onClose={() => setAdding(false)} />}
      {editing && roles && <EditUserModal user={editing} roles={roles} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function AddUserModal({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phone: '', roleId: roles[0]?.id ?? '' });
  const save = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: JSON.stringify({ ...form, phone: form.phone || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Modal title="Add User" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div><label className="label">Full Name</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div><label className="label">Phone (H/P)</label><input className="input" placeholder="012-345 6789" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div><label className="label">Password (min 6 chars)</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></div>
        <div><label className="label">Role</label>
          <select className="input" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Create User</button>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, roles, onClose }: { user: User; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '', roleId: user.roleId });
  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ fullName: form.fullName, phone: form.phone || null, roleId: form.roleId }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Modal title={`Edit ${user.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div><label className="label">Full Name</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
        <div><label className="label">Email</label><input className="input" value={user.email} disabled /><p className="text-xs text-gray-400 mt-1">Login email cannot be changed here.</p></div>
        <div><label className="label">Phone (H/P) — prints on this salesperson&apos;s quotations</label><input className="input" placeholder="012-345 6789" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="label">Role</label>
          <select className="input" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></div>
        <ErrorText error={save.error} />
        <button className="btn-primary w-full justify-center" disabled={save.isPending}>Save Changes</button>
      </form>
    </Modal>
  );
}

/** Configurable RBAC — tick permissions per role. */
function RolesSection() {
  const qc = useQueryClient();
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const { data: permissions } = useQuery({ queryKey: ['permissions'], queryFn: () => api<Permission[]>('/roles/permissions') });
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const save = useMutation({
    mutationFn: ({ roleId, permissionIds }: { roleId: string; permissionIds: string[] }) =>
      api(`/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionIds }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setEditingRole(null); },
  });

  return (
    <Card>
      <h3 className="font-semibold mb-3">Roles & Permissions</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {roles?.map((r) => (
          <button key={r.id} className="card !shadow-none border p-3 text-left hover:border-primary transition" onClick={() => setEditingRole(r)}>
            <div className="font-medium">{r.name}</div>
            <div className="text-xs text-gray-500">{r.permissions.length} permissions · {r._count.users} user(s)</div>
          </button>
        ))}
      </div>
      {editingRole && permissions && (
        <RolePermissionsModal role={editingRole} permissions={permissions}
          onSave={(ids) => save.mutate({ roleId: editingRole.id, permissionIds: ids })}
          saving={save.isPending}
          onClose={() => setEditingRole(null)} />
      )}
    </Card>
  );
}

function RolePermissionsModal({ role, permissions, onSave, saving, onClose }: {
  role: Role; permissions: Permission[]; onSave: (ids: string[]) => void; saving: boolean; onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions.map((p) => p.permission.id)));
  const groups = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    const g = p.code.split('.')[0];
    (acc[g] = acc[g] || []).push(p);
    return acc;
  }, {});
  return (
    <Modal title={`Permissions — ${role.name}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Object.entries(groups).map(([g, perms]) => (
          <div key={g} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
            <div className="font-medium text-sm capitalize mb-2">{g}</div>
            {perms.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm py-0.5">
                <input type="checkbox" checked={selected.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(p.id); else next.delete(p.id);
                    setSelected(next);
                  }} />
                {p.code.endsWith('.read') ? 'Read' : 'Write'}
              </label>
            ))}
          </div>
        ))}
      </div>
      <button className="btn-primary w-full justify-center mt-4" disabled={saving} onClick={() => onSave(Array.from(selected))}>
        Save Permissions
      </button>
    </Modal>
  );
}

/** Raw JSON editing of the settings store: rating weights, alert thresholds, defaults. */
function SystemSettingsSection() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api<Setting[]>('/settings') });
  const [editing, setEditing] = useState<Setting | null>(null);
  const [draft, setDraft] = useState('');

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setEditing(null); },
  });

  return (
    <Card>
      <h3 className="font-semibold mb-1">System Configuration</h3>
      <p className="text-xs text-gray-500 mb-3">Rating weights, alert thresholds, quotation defaults and recommendation weights — everything is configurable, nothing hardcoded.</p>
      <Table head={['Key', 'Value', '']} empty={settings?.length === 0}>
        {settings?.map((s) => (
          <tr key={s.key}>
            <td className="td font-mono text-xs">{s.key}</td>
            <td className="td font-mono text-xs text-gray-500 max-w-md truncate">{JSON.stringify(s.value)}</td>
            <td className="td">
              {hasPermission('settings.write') && (
                <button className="text-primary hover:underline text-sm"
                  onClick={() => { setEditing(s); setDraft(JSON.stringify(s.value, null, 2)); }}>Edit</button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <Modal title={`Edit ${editing.key}`} onClose={() => setEditing(null)}>
          <textarea className="input font-mono text-xs" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <ErrorText error={save.error} />
          <button className="btn-primary w-full justify-center mt-3" disabled={save.isPending}
            onClick={() => {
              try { save.mutate({ key: editing.key, value: JSON.parse(draft) }); }
              catch { alert('Invalid JSON'); }
            }}>Save</button>
        </Modal>
      )}
    </Card>
  );
}
