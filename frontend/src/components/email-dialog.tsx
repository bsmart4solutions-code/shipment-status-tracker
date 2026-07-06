'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ErrorText, Modal } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Send-by-email dialog shared by quotations and invoices. Blank recipient
 * means "use the customer's email on file". When SMTP isn't configured the
 * backend simulates the send and we tell the user so, honestly.
 */
export function EmailDialog({ title, endpoint, onClose }: { title: string; endpoint: string; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');

  const send = useMutation({
    mutationFn: () => api<{ sent: boolean; simulated: boolean; to: string }>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ to: to || undefined, message: message || undefined }),
    }),
  });

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Recipient (leave blank to use the customer&apos;s email)</label>
          <input className="input" type="email" placeholder="customer@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Message (optional, shown above the summary table)</label>
          <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <ErrorText error={send.error} />
        {send.data && (
          <p className={`text-sm ${send.data.simulated ? 'text-amber-600' : 'text-emerald-600'}`}>
            {send.data.simulated
              ? `SMTP is not configured — the email to ${send.data.to} was composed and logged, not sent. Set SMTP_HOST to enable real sending.`
              : `Sent to ${send.data.to}.`}
          </p>
        )}
        <button className="btn-primary w-full justify-center" onClick={() => send.mutate()} disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Modal>
  );
}
