/**
 * Typed fetch wrapper. JWT lives in localStorage; a 401 clears the session
 * and bounces to /login. All calls go through the Next.js rewrite to the
 * NestJS backend, so the browser only ever talks to one origin.
 */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('erp_token');
}

export function getUser(): { id: string; email: string; fullName: string; role: string; permissions: string[] } | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('erp_user');
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token: string, user: unknown) {
  localStorage.setItem('erp_token', token);
  localStorage.setItem('erp_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('erp_token');
  localStorage.removeItem('erp_user');
}

export function hasPermission(code: string): boolean {
  const user = getUser();
  if (!user) return false;
  if (user.role === 'Administrator') return true;
  return user.permissions.includes(code);
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message || res.statusText;
    throw new ApiError(res.status, msg);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) return (await res.text()) as T;
  return res.json();
}

/** Download an authenticated CSV export and trigger a browser save. */
export async function downloadCsv(path: string, filename: string) {
  const csv = await api<string>(path);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
