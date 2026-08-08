import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { cleanupRun, createTestApp, login, makeCustomer, prisma, tag } from './setup';

/**
 * AR payment reversal (Sprint 07), over real HTTP against real Postgres.
 *
 * Two things here cannot be tested any other way. The concurrency cases need
 * genuine simultaneous transactions — unit tests stub `$transaction` and
 * `$queryRaw`, so lock ordering does not exist in that world, which is exactly
 * how the identical AP defect survived until Sprint 04's integration layer.
 * And the AR-balance assertions need the real aging query, since the whole
 * point of a reversal is that money stops counting as collected.
 */
describe('AR payment reversal over real HTTP (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app, 'admin@erp.local', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
  });

  afterAll(async () => {
    await cleanupRun();
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());

  async function issuedInvoice(customerId: string, total: number) {
    const created = await http().post('/api/invoices').set(auth())
      .send({ customerId, currency: 'MYR', taxPct: 0, notes: tag('invoice'),
        items: [{ description: 'freight', unitPrice: total, quantity: 1 }] })
      .expect(201);
    await http().post(`/api/invoices/${created.body.id}/issue`).set(auth()).send({}).expect(201);
    return created.body.id as string;
  }

  const pay = (invoiceId: string, amount: number) =>
    http().post(`/api/invoices/${invoiceId}/payments`).set(auth()).send({ amount });

  const reverse = (paymentId: string, reason = 'keyed against the wrong invoice') =>
    http().post(`/api/invoices/payments/${paymentId}/reverse`).set(auth()).send({ reason });

  const getInvoice = async (id: string) =>
    (await http().get(`/api/invoices/${id}`).set(auth()).expect(200)).body;

  describe('the correction the system previously could not do', () => {
    it('reverses a receipt and returns the invoice to ISSUED', async () => {
      const c = await makeCustomer({ label: 'ar-rev-basic' });
      const id = await issuedInvoice(c.id, 1000);
      const p = await pay(id, 1000).expect(201);
      expect((await getInvoice(id)).status).toBe('PAID');

      await reverse(p.body.id).expect(201);

      const after = await getInvoice(id);
      expect(after.status).toBe('ISSUED');
      expect(Number(after.amountPaid)).toBe(0);
    });

    it('drops PAID to PARTIALLY_PAID when only one of two receipts is reversed', async () => {
      const c = await makeCustomer({ label: 'ar-rev-partial' });
      const id = await issuedInvoice(c.id, 1000);
      const first = await pay(id, 600).expect(201);
      await pay(id, 400).expect(201);
      expect((await getInvoice(id)).status).toBe('PAID');

      await reverse(first.body.id).expect(201);

      const after = await getInvoice(id);
      expect(after.status).toBe('PARTIALLY_PAID');
      expect(Number(after.amountPaid)).toBe(400);
    });

    it('frees the invoice to be cancelled — the workflow that used to dead-end', async () => {
      // Before this endpoint existed, cancel() said "reverse the payments
      // first" and nothing in the system could do that. The only way out was
      // to void and reissue, burning an invoice number.
      const c = await makeCustomer({ label: 'ar-rev-cancel' });
      const id = await issuedInvoice(c.id, 500);
      const p = await pay(id, 500).expect(201);

      const blocked = await http().post(`/api/invoices/${id}/cancel`).set(auth()).expect(409);
      expect(blocked.body.message).toMatch(/reverse the payments first/);

      await reverse(p.body.id).expect(201);
      await http().post(`/api/invoices/${id}/cancel`).set(auth()).expect(201);
      expect((await getInvoice(id)).status).toBe('CANCELLED');
    });

    it('preserves the reversed row with who, when and why', async () => {
      const c = await makeCustomer({ label: 'ar-rev-trail' });
      const id = await issuedInvoice(c.id, 300);
      const p = await pay(id, 300).expect(201);

      await reverse(p.body.id, 'customer paid twice by mistake').expect(201);

      // The cash trail must still show the money arrived and was backed out.
      const row = await prisma.invoicePayment.findUnique({ where: { id: p.body.id } });
      expect(row).not.toBeNull();
      expect(Number(row!.amount)).toBe(300);
      expect(row!.reversedAt).toBeInstanceOf(Date);
      expect(row!.reversedById).not.toBeNull();
      expect(row!.reversalReason).toBe('customer paid twice by mistake');

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'invoicePayment', entityId: p.body.id, action: 'REVERSE_PAYMENT' },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('AR balance actually moves back', () => {
    it('restores the outstanding balance in the aging report', async () => {
      const c = await makeCustomer({ label: 'ar-rev-aging' });
      const id = await issuedInvoice(c.id, 800);

      const owedBefore = await outstandingFor(id);
      expect(owedBefore).toBe(800);

      const p = await pay(id, 800).expect(201);
      expect(await outstandingFor(id)).toBeUndefined(); // settled — drops off aging

      await reverse(p.body.id).expect(201);
      // The debt is back. A reversal that left AR reporting the invoice as
      // collected would be worse than no reversal at all.
      expect(await outstandingFor(id)).toBe(800);
    });

    /** Aging rows are keyed `id` (the invoice id) and carry `balance`. */
    async function outstandingFor(invoiceId: string): Promise<number | undefined> {
      const res = await http().get('/api/invoices/aging').set(auth()).expect(200);
      const row = res.body.rows.find((r: { id: string }) => r.id === invoiceId);
      return row ? Number(row.balance) : undefined;
    }
  });

  describe('guards', () => {
    it('rejects a reversal with no reason', async () => {
      const c = await makeCustomer({ label: 'ar-rev-noreason' });
      const id = await issuedInvoice(c.id, 100);
      const p = await pay(id, 100).expect(201);

      const res = await http().post(`/api/invoices/payments/${p.body.id}/reverse`)
        .set(auth()).send({}).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/reason is required/i);
    });

    it('refuses to reverse the same payment twice', async () => {
      const c = await makeCustomer({ label: 'ar-rev-twice' });
      const id = await issuedInvoice(c.id, 100);
      const p = await pay(id, 100).expect(201);

      await reverse(p.body.id).expect(201);
      const second = await reverse(p.body.id).expect(400);
      expect(second.body.message).toMatch(/already been reversed/);
    });

    it('404s on an unknown payment', async () => {
      await http().post('/api/invoices/payments/00000000-0000-0000-0000-000000000000/reverse')
        .set(auth()).send({ reason: 'x' }).expect(404);
    });
  });

  describe('concurrency — the class of defect that only shows up here', () => {
    it('two simultaneous reversals of the same payment cannot both succeed', async () => {
      const c = await makeCustomer({ label: 'ar-rev-race' });
      const id = await issuedInvoice(c.id, 1000);
      const p = await pay(id, 1000).expect(201);

      const [a, b] = await Promise.all([reverse(p.body.id), reverse(p.body.id)]);
      const codes = [a.status, b.status].sort();
      expect(codes).toEqual([201, 400]);

      // And the invoice reflects exactly one reversal, not two.
      const after = await getInvoice(id);
      expect(Number(after.amountPaid)).toBe(0);
      expect(after.status).toBe('ISSUED');
    });

    it('two simultaneous receipts cannot lose one from amountPaid', async () => {
      // Pre-existing AR defect fixed alongside this work: recordPayment read
      // the balance OUTSIDE the transaction, so both requests saw amountPaid=0
      // and the second overwrote the first — a payment row existed with its
      // money missing from the invoice, which could sit unpaid while the cash
      // was in the bank.
      const c = await makeCustomer({ label: 'ar-pay-race' });
      const id = await issuedInvoice(c.id, 1000);

      const [a, b] = await Promise.all([pay(id, 400), pay(id, 400)]);
      expect([a.status, b.status]).toEqual([201, 201]);

      const after = await getInvoice(id);
      expect(Number(after.amountPaid)).toBe(800);
      expect(after.status).toBe('PARTIALLY_PAID');
    });

    it('two simultaneous receipts still cannot jointly overpay', async () => {
      const c = await makeCustomer({ label: 'ar-pay-overpay-race' });
      const id = await issuedInvoice(c.id, 1000);

      const [a, b] = await Promise.all([pay(id, 700), pay(id, 700)]);
      const codes = [a.status, b.status].sort();
      expect(codes).toEqual([201, 400]);
      expect(Number((await getInvoice(id)).amountPaid)).toBe(700);
    });
  });
});
