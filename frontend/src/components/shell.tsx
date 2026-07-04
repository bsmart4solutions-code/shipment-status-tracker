'use client';

/**
 * Application shell: sidebar navigation (permission-filtered), topbar with
 * global search (Ctrl/Cmd+K), notifications bell, dark-mode toggle and the
 * signed-in user. Wraps every authenticated page.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, FileText, Home, LayoutDashboard, LogOut, Moon, Package, Receipt, Scale,
  Search, Settings, Ship, Sun, Truck, Users, Wallet, X,
} from 'lucide-react';
import { api, clearSession, getToken, getUser, hasPermission } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.read' },
  { href: '/quotations', label: 'Quotations', icon: FileText, perm: 'quotations.read' },
  { href: '/jobs', label: 'Jobs / Shipments', icon: Package, perm: 'jobs.read' },
  { href: '/invoices', label: 'Invoices', icon: Receipt, perm: 'invoices.read' },
  { href: '/customers', label: 'Customers', icon: Users, perm: 'customers.read' },
  { href: '/vendors', label: 'Vendors', icon: Truck, perm: 'vendors.read' },
  { href: '/services', label: 'Services', icon: Home, perm: 'services.read' },
  { href: '/rates', label: 'Vendor Rates', icon: Wallet, perm: 'rates.read' },
  { href: '/compare', label: 'Compare Vendors', icon: Scale, perm: 'rates.read' },
  { href: '/pnl', label: 'Profit & Loss', icon: Wallet, perm: 'reports.read' },
  { href: '/reports', label: 'Reports', icon: FileText, perm: 'reports.read' },
  { href: '/settings', label: 'Settings', icon: Settings, perm: 'settings.read' },
];

interface Notification {
  id: string; type: string; title: string; message: string; isRead: boolean; createdAt: string;
}

export function Shell({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Permissions and theme come from localStorage, which the server can't see;
  // render nothing until mounted to avoid hydration mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [dark, setDark] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const user = useMemo(() => getUser(), []);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    const stored = localStorage.getItem('erp_theme');
    const isDark = stored === 'dark';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
    refetchInterval: 60_000,
    enabled: !!getToken() && hasPermission('notifications.read'),
  });
  const unread = notifications?.filter((n) => !n.isRead).length ?? 0;

  function toggleDark() {
    const next = !dark;
    setDark(next);
    localStorage.setItem('erp_theme', next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  const crumbs = pathname.split('/').filter(Boolean);

  if (!mounted) return null;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-60 flex-col bg-gray-900 text-gray-300 shrink-0">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-800">
          <div className="bg-primary text-white rounded-lg p-1.5"><Ship size={18} /></div>
          <div>
            <div className="font-bold text-white leading-tight">Logistics ERP</div>
            <div className="text-[10px] text-gray-500">ERP & CRM System</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 text-sm">
          {NAV.filter((n) => hasPermission(n.perm)).map((n) => (
            <Link key={n.href} href={n.href}
              className={cn('flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition',
                pathname.startsWith(n.href) && 'bg-primary text-white hover:bg-primary')}>
              <n.icon size={16} /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
          Signed in as <span className="text-gray-300">{user?.fullName}</span>
          <div className="text-[10px]">{user?.role}</div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 md:px-6 py-3 flex items-center gap-3 sticky top-0 z-20">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-400 flex gap-1">
              {crumbs.map((c, i) => (
                <span key={i} className="capitalize">{i > 0 && ' / '}{c}</span>
              ))}
            </div>
            <h1 className="text-lg font-bold truncate">{title}</h1>
          </div>
          {actions}
          <button onClick={() => setSearchOpen(true)} className="btn-ghost !px-3" title="Search (Ctrl+K)">
            <Search size={16} /> <span className="hidden lg:inline text-xs text-gray-400">Ctrl K</span>
          </button>
          <div className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)} className="btn-ghost !px-3 relative" title="Notifications">
              <Bell size={16} />
              {unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{unread}</span>}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-96 max-h-96 overflow-y-auto card p-2 z-50">
                <div className="flex justify-between items-center px-2 py-1">
                  <span className="text-sm font-semibold">Notifications</span>
                  <button onClick={() => setNotifOpen(false)}><X size={14} /></button>
                </div>
                {(notifications ?? []).length === 0 && <p className="text-sm text-gray-400 p-3">No notifications.</p>}
                {(notifications ?? []).map((n) => (
                  <div key={n.id} className={cn('px-2 py-2 rounded-lg text-sm border-b border-gray-100 dark:border-gray-800 last:border-0', !n.isRead && 'bg-blue-50 dark:bg-blue-950/40')}>
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-gray-500">{n.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={toggleDark} className="btn-ghost !px-3" title="Toggle dark mode">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={logout} className="btn-ghost !px-3" title="Sign out"><LogOut size={16} /></button>
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

/** Ctrl+K palette: searches customers, vendors, quotations and jobs at once. */
function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState('');
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['global-search', term],
    queryFn: async () => {
      const [customers, vendors, quotations, jobs] = await Promise.all([
        hasPermission('customers.read') ? api<{ items: { id: string; companyName: string; code: string }[] }>(`/customers?search=${encodeURIComponent(term)}&pageSize=5`) : { items: [] },
        hasPermission('vendors.read') ? api<{ items: { id: string; name: string; code: string }[] }>(`/vendors?search=${encodeURIComponent(term)}&pageSize=5`) : { items: [] },
        hasPermission('quotations.read') ? api<{ items: { id: string; quoteNumber: string; status: string }[] }>(`/quotations?search=${encodeURIComponent(term)}&pageSize=5`) : { items: [] },
        hasPermission('jobs.read') ? api<{ items: { id: string; jobNumber: string; status: string }[] }>(`/jobs?search=${encodeURIComponent(term)}&pageSize=5`) : { items: [] },
      ]);
      return { customers: customers.items, vendors: vendors.items, quotations: quotations.items, jobs: jobs.items };
    },
    enabled: term.length >= 2,
  });

  function go(path: string) {
    onClose();
    router.push(path);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-24 p-4" onClick={onClose}>
      <div className="card w-full max-w-xl p-4" onClick={(e) => e.stopPropagation()}>
        <input autoFocus className="input" placeholder="Search customers, vendors, quotations, jobs…"
          value={term} onChange={(e) => setTerm(e.target.value)} />
        {data && (
          <div className="mt-3 space-y-3 max-h-80 overflow-y-auto text-sm">
            {data.customers.length > 0 && (
              <Section title="Customers">{data.customers.map((c) => (
                <button key={c.id} onClick={() => go(`/customers?highlight=${c.id}`)} className="block w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800">{c.code} — {c.companyName}</button>
              ))}</Section>
            )}
            {data.vendors.length > 0 && (
              <Section title="Vendors">{data.vendors.map((v) => (
                <button key={v.id} onClick={() => go(`/vendors?highlight=${v.id}`)} className="block w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800">{v.code} — {v.name}</button>
              ))}</Section>
            )}
            {data.quotations.length > 0 && (
              <Section title="Quotations">{data.quotations.map((q) => (
                <button key={q.id} onClick={() => go(`/quotations/${q.id}`)} className="block w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800">{q.quoteNumber} — {q.status}</button>
              ))}</Section>
            )}
            {data.jobs.length > 0 && (
              <Section title="Jobs">{data.jobs.map((j) => (
                <button key={j.id} onClick={() => go(`/jobs?highlight=${j.id}`)} className="block w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800">{j.jobNumber} — {j.status}</button>
              ))}</Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-gray-400 px-2 mb-1">{title}</div>
      {children}
    </div>
  );
}
