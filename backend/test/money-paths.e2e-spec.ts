import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { cleanupRun, createTestApp, login, makeCustomer, makeVendor, prisma, tag } from './setup';

/**
 * The defect classes unit tests structurally cannot catch (Sprint 04, T-6).
 *
 * Every case here failed — or would have failed — against a mock:
 *  · the `::uuid` cast that broke every row-locked path in Sprint 03 (unit
 *    tests stub `$queryRaw`, so the SQL was never executed)
 *  · void returning 400 instead of the contracted 409
 *  · P2002 surfacing as 500 instead of a mapped 409
 *  · row locking under genuinely concurrent requests
 *  · the ownership boundary: AP must not move AR, job or P&L figures
 */
describe('Money paths over real HTTP (e2e)', () => {
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

  async function approvedBill(vendorId: string, total: number, invoiceNo: string, jobId?: string) {
    const created = await http().post('/api/payables').set(auth())
      .send({ vendorId, vendorInvoiceNo: invoiceNo, taxPct: 0, notes: tag('bill'), jobId,
        items: [{ description: 'carrier charge', unitPrice: total, quantity: 1 }] })
      .expect(201);
    await http().post(`/api/payables/${created.body.id}/approve`).set(auth()).expect(201);
    return created.body.id as string;
  }

  // ── Row-locked paths: these all execute `SELECT … FOR UPDATE` ──────────
  describe('row-locked operations execute against a real database', () => {
    it('runs the full vendor bill lifecycle: approve → pay → reverse → void', async () => {
      const v = await makeVendor('lifecycle');
      const billId = await approvedBill(v.id, 1000, 'E2E-LIFECYCLE-1');

      const pay = await http().post(`/api/payables/${billId}/payments`).set(auth())
        .send({ amount: 400 }).expect(201);
      let bill = await http().get(`/api/payables/${billId}`).set(auth()).expect(200);
      expect(bill.body.status).toBe('PARTIALLY_PAID');
      expect(bill.body.outstanding).toBe(600);

      await http().post(`/api/payables/payments/${pay.body.id}/reverse`).set(auth())
        .send({ reason: 'paid the wrong vendor' }).expect(201);
      bill = await http().get(`/api/payables/${billId}`).set(auth()).expect(200);
      expect(bill.body.status).toBe('APPROVED');
      expect(bill.body.outstanding).toBe(1000);

      await http().post(`/api/payables/${billId}/void`).set(auth())
        .send({ reason: 'entered against the wrong vendor' }).expect(201);
      bill = await http().get(`/api/payables/${billId}`).set(auth()).expect(200);
      expect(bill.body.status).toBe('VOID');
    });

    it('issues an invoice and records a payment through the locked paths', async () => {
      const c = await makeCustomer({ label: 'locked-ar' });
      const id = await issuedInvoice(c.id, 500);
      await http().post(`/api/invoices/${id}/payments`).set(auth()).send({ amount: 500 }).expect(201);
      const inv = await prisma.invoice.findUnique({ where: { id } });
      expect(inv?.status).toBe('PAID');
    });
  });

  // ── Status-code contracts, end to end through the exception filter ─────
  describe('status-code contracts', () => {
    it('void with live payments → 409 with the actionable message', async () => {
      const v = await makeVendor('void-409');
      const billId = await approvedBill(v.id, 800, 'E2E-VOID-409');
      await http().post(`/api/payables/${billId}/payments`).set(auth()).send({ amount: 100 }).expect(201);

      const res = await http().post(`/api/payables/${billId}/void`).set(auth()).send({}).expect(409);
      expect(res.body.message).toMatch(/reverse the payment\(s\) first/);
    });

    it('overpayment → 400', async () => {
      const v = await makeVendor('overpay');
      const billId = await approvedBill(v.id, 100, 'E2E-OVERPAY');
      const res = await http().post(`/api/payables/${billId}/payments`).set(auth()).send({ amount: 500 }).expect(400);
      expect(res.body.message).toMatch(/exceeds remaining balance/);
    });

    it('duplicate vendor invoice number for the same vendor → 409', async () => {
      const v = await makeVendor('dup');
      await approvedBill(v.id, 100, 'E2E-DUP-1');
      const res = await http().post('/api/payables').set(auth())
        .send({ vendorId: v.id, vendorInvoiceNo: 'E2E-DUP-1', notes: tag('bill'),
          items: [{ description: 'x', unitPrice: 1, quantity: 1 }] })
        .expect(409);
      expect(res.body.message).toMatch(/already been recorded for this vendor/);
    });

    it('a voided bill releases its invoice number for re-entry (Sprint 03A H-1)', async () => {
      const v = await makeVendor('void-reuse');
      const billId = await approvedBill(v.id, 100, 'E2E-REUSE-1');
      await http().post(`/api/payables/${billId}/void`).set(auth()).send({ reason: 'keyed wrong' }).expect(201);

      const again = await http().post('/api/payables').set(auth())
        .send({ vendorId: v.id, vendorInvoiceNo: 'E2E-REUSE-1', notes: tag('bill'),
          items: [{ description: 'corrected', unitPrice: 250, quantity: 1 }] })
        .expect(201);
      expect(again.body.vendorInvoiceNo).toBe('E2E-REUSE-1');
    });

    it('a raw Prisma unique violation (P2002) → 409, not 500', async () => {
      // POST /fx has no service-level duplicate pre-check, so the constraint
      // violation reaches Prisma and must be mapped by the global filter.
      const payload = { baseCurrency: 'USD', quoteCurrency: 'MYR', rate: 4.45, effectiveDate: '2026-01-01' };
      const res = await http().post('/api/fx').set(auth()).send(payload).expect(409);
      expect(res.body.statusCode).toBe(409);
      expect(res.body.message).toMatch(/already exists/);
    });
  });

  // ── Concurrency: the row lock must actually serialize ──────────────────
  describe('row locking under concurrent requests', () => {
    it('two simultaneous payments cannot jointly overpay a bill', async () => {
      const v = await makeVendor('race-pay');
      const billId = await approvedBill(v.id, 1000, 'E2E-RACE-PAY');

      const results = await Promise.allSettled([
        http().post(`/api/payables/${billId}/payments`).set(auth()).send({ amount: 700 }),
        http().post(`/api/payables/${billId}/payments`).set(auth()).send({ amount: 700 }),
      ]);
      const codes = results
        .map((r) => (r.status === 'fulfilled' ? (r.value as { status: number }).status : 0))
        .sort();
      // One succeeds (201), the other is refused as an overpayment (400).
      expect(codes).toEqual([201, 400]);

      const bill = await prisma.vendorBill.findUnique({ where: { id: billId } });
      expect(Number(bill?.amountPaid)).toBe(700); // never 1400
    });

    it('two simultaneous reversals of the same payment cannot double-credit it', async () => {
      const v = await makeVendor('race-reverse');
      const billId = await approvedBill(v.id, 1000, 'E2E-RACE-REV');
      const pay = await http().post(`/api/payables/${billId}/payments`).set(auth()).send({ amount: 600 }).expect(201);

      const results = await Promise.allSettled([
        http().post(`/api/payables/payments/${pay.body.id}/reverse`).set(auth()).send({ reason: 'first' }),
        http().post(`/api/payables/payments/${pay.body.id}/reverse`).set(auth()).send({ reason: 'second' }),
      ]);
      const codes = results
        .map((r) => (r.status === 'fulfilled' ? (r.value as { status: number }).status : 0))
        .sort();
      expect(codes).toEqual([201, 400]); // exactly one reversal takes effect

      const bill = await prisma.vendorBill.findUnique({ where: { id: billId } });
      expect(Number(bill?.amountPaid)).toBe(0);
      expect(bill?.status).toBe('APPROVED');
    });
  });

  // ── The invariant Sprint 03 was judged on, now automated (review M-7) ──
  describe('ownership boundary: AP never moves AR, job or P&L figures', () => {
    it('a full AP cycle leaves every AR, job and P&L figure numerically unchanged', async () => {
      const snapshot = async () => {
        const [aging, jobs, pnl] = await Promise.all([
          http().get('/api/invoices/aging').set(auth()).expect(200),
          http().get('/api/jobs?pageSize=100').set(auth()).expect(200),
          http().get('/api/pnl?from=2020-01-01&to=2030-12-31').set(auth()).expect(200),
        ]);
        return JSON.stringify({
          ar: aging.body.totalOutstanding,
          jobs: jobs.body.items
            .map((j: { jobNumber: string; actualCost: string; actualRevenue: string; profit: string }) =>
              [j.jobNumber, j.actualCost, j.actualRevenue, j.profit])
            .sort(),
          pnl: pnl.body.totals,
        });
      };

      const before = await snapshot();

      const v = await makeVendor('boundary');
      const job = await prisma.job.findFirst({ where: { deletedAt: null }, select: { id: true } });
      const billId = await approvedBill(v.id, 1234.56, 'E2E-BOUNDARY-1', job?.id);
      const pay = await http().post(`/api/payables/${billId}/payments`).set(auth()).send({ amount: 234.56 }).expect(201);
      await http().post(`/api/payables/payments/${pay.body.id}/reverse`).set(auth()).send({ reason: 'boundary test' }).expect(201);
      await http().post(`/api/payables/${billId}/void`).set(auth()).send({ reason: 'boundary test' }).expect(201);

      expect(await snapshot()).toBe(before);
    });
  });
});
