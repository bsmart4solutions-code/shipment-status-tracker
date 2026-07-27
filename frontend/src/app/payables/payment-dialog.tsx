'use client';

/**
 * Vendor payment dialog: record a payment against a bill and review the
 * payment history. Reversal is a soft reversal — the row stays, struck
 * through, showing who reversed it, when and why.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { Card, ErrorText, Modal, Table } from '@/components/ui';
import { api, hasPermission } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/utils';
import type { BillRow } from './page';

interface Payment {
  id: string; amount: string; paidAt: string; method: string | null; reference: string | null;
  reversedAt: string | null; reversalReason: string | null;
}
interface BillDetail {
  id: string; billNumber: string; currency: string; totalAmount: string; amountPaid: string;
  outstanding: number; status: string; vendor: { name: string }; payments: Payment[];
}

export function PaymentDialog({ bill, onClose }: { bill: BillRow; onClose: () => void }) {
  const qc = useQueryClient();
  const canWrite = hasPermission('payables.write');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['payable-payments', bill.id],
    queryFn: () => api<BillDetail>(`/payables/${bill.id}`),
  });

  const invalidate = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ['payables'] });
    qc.invalidateQueries({ queryKey: ['job-cost-variance'] });
  };

  const pay = useMutation({
    mutationFn: () => api(`/payables/${bill.id}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(amount), paidAt: paidAt || undefined,
        method: method || undefined, reference: reference || undefined,
      }),
    }),
    onSuccess: () => { setAmount(''); setReference(''); invalidate(); },
  });

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/payables/payments/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: invalidate,
  });

  const outstanding = data?.outstanding ?? bill.outstanding;
  const canPay = canWrite && (data?.status === 'APPROVED' || data?.status === 'PARTIALLY_PAID');
  const amountNum = Number(amount);
  const amountInvalid = !!amount && (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > outstanding + 0.005);

  return (
    <Modal title={`Payments — ${bill.billNumber}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>}
        <ErrorText error={error} />

        {data && (
          <>
            <Card className="!bg-primary/5 dark:!bg-primary/10 !border-primary/20">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><div className="text-xs text-gray-500">Vendor</div>
                  <div className="font-semibold">{data.vendor.name}</div></div>
                <div><div className="text-xs text-gray-500">Bill Total</div>
                  <div className="font-semibold">{fmtMoney(data.totalAmount, data.currency)}</div></div>
                <div><div className="text-xs text-gray-500">Paid</div>
                  <div className="font-semibold">{fmtMoney(data.amountPaid, data.currency)}</div></div>
                <div><div className="text-xs text-gray-500">Outstanding</div>
                  <div className="text-lg font-bold text-primary">{fmtMoney(outstanding, data.currency)}</div></div>
              </div>
            </Card>

            {canPay && (
              <Card className="!p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Record a payment</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><label className="label">Amount <span className="text-red-500">*</span></label>
                    <input className="input text-right" type="number" step="0.01" min="0.01" value={amount}
                      onChange={(e) => setAmount(e.target.value)} /></div>
                  <div><label className="label">Paid At</label>
                    <input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>
                  <div><label className="label">Method</label>
                    <input className="input" placeholder="Bank transfer / cheque" value={method}
                      onChange={(e) => setMethod(e.target.value)} /></div>
                  <div><label className="label">Reference</label>
                    <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
                </div>
                {amountInvalid && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                    Enter an amount between 0 and the outstanding balance ({fmtMoney(outstanding, data.currency)}).
                  </p>
                )}
                <ErrorText error={pay.error} />
                <button className="btn-primary w-full justify-center mt-3"
                  disabled={!amount || amountInvalid || pay.isPending}
                  onClick={() => pay.mutate()}>
                  {pay.isPending ? 'Recording…' : 'Record Payment'}
                </button>
              </Card>
            )}

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Payment history ({data.payments.length})
              </div>
              <Table head={['Date', 'Amount', 'Method', 'Reference', 'Status', '']} empty={data.payments.length === 0}>
                {data.payments.map((p) => (
                  <tr key={p.id} className={p.reversedAt ? 'opacity-60' : ''}>
                    <td className="td text-gray-500">{fmtDate(p.paidAt)}</td>
                    <td className={`td font-medium ${p.reversedAt ? 'line-through' : ''}`}>
                      {fmtMoney(p.amount, data.currency)}
                    </td>
                    <td className="td text-gray-500">{p.method || '-'}</td>
                    <td className="td text-gray-500">{p.reference || '-'}</td>
                    <td className="td">
                      {p.reversedAt
                        ? <span className="text-xs text-red-500" title={p.reversalReason ?? ''}>
                            Reversed {fmtDate(p.reversedAt)}{p.reversalReason ? ` — ${p.reversalReason}` : ''}
                          </span>
                        : <span className="text-xs text-emerald-600">Applied</span>}
                    </td>
                    <td className="td text-right">
                      {canWrite && !p.reversedAt && (
                        <button className="text-red-500 hover:underline text-sm inline-flex items-center gap-1"
                          onClick={() => {
                            const reason = prompt(`Reverse this payment of ${fmtMoney(p.amount, data.currency)}?\n\nEnter a reason (required):`);
                            if (reason && reason.trim()) reverse.mutate({ id: p.id, reason: reason.trim() });
                          }}>
                          <Undo2 size={13} /> Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <ErrorText error={reverse.error} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
