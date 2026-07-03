'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shell } from '@/components/shell';
import { Card, ErrorText, Modal, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';

interface User { id: string; email: string; fullName: string; isActive: boolean; roleId: string; role: { name: string } }
interface Role { id: string; name: string; permissions: { permission: { id: string; code: string } }[]; _count: { users: number } }
interface Permission { id: string; code: string; label: string }
interface Setting { key: string; value: unknown }

export default function SettingsPage() {
  const canUsers = hasPermission('users.read');
  const canSettings = hasPermission('settings.read');

  return (
    <Shell title="Settings">
      <div className="space-y-6">
        {canUsers && <UsersSection />}
        {canUsers && <RolesSection />}
        {canSettings && <SystemSettingsSection />}
      </div>
    </Shell>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });

  const toggle = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !u.isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <Card>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Users</h3>
        {hasPermission('users.write') && <button className="btn-primary" onClick={() => setAdding(true)}>Add User</button>}
      </div>
      <Table head={['Name', 'Email', 'Role', 'Status', '']} empty={users?.length === 0}>
        {users?.map((u) => (
          <tr key={u.id}>
            <td className="td font-medium">{u.fullName}</td>
            <td className="td text-gray-500">{u.email}</td>
            <td className="td"><span className="badge bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">{u.role.name}</span></td>
            <td className="td">{u.isActive ? '✓ Active' : '✗ Disabled'}</td>
            <td className="td">
              {hasPermission('users.write') && (
                <button className="text-primary hover:underline text-sm" onClick={() => toggle.mutate(u)}>
                  {u.isActive ? 'Disable' : 'Enable'}
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {adding && roles && <AddUserModal roles={roles} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddUserModal({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: '', password: '', fullName: '', roleId: roles[0]?.id ?? '' });
  const save = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Modal title="Add User" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <div><label className="label">Full Name</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
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
