'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ship } from 'lucide-react';
import { api, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@erp.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api<{ accessToken: string; user: unknown }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(res.accessToken, res.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-700 to-blue-950 p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-primary text-white rounded-xl p-2"><Ship size={24} /></div>
          <div>
            <h1 className="text-xl font-bold">Logistics ERP</h1>
            <p className="text-xs text-gray-500">ERP & CRM Management System</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-4 text-center">Demo: admin@erp.local / Admin@123</p>
      </div>
    </div>
  );
}
