import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { cleanupRun, createTestApp, login, makeCustomer, makeUser, prisma, tag } from './setup';

/**
 * Credit limit enforcement over real HTTP (Sprint 04, P0-7).
 *
 * Approved policy under test:
 *   D-1 hard block · D-2 invoice issue is the ONLY gated action ·
 *   D-4 effective limit = MIN of the non-null limits · D-5 hold is absolute ·
 *   D-7 override is Administrator/Manager only with a mandatory reason.
 */
describe('Credit enforcement (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let salesToken: string;
  // Finance holds invoices.write but NOT credit.override — the exact boundary D-7 draws.
  let financeToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await login(app, 'admin@erp.local', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
    salesToken = await login(app, 'sales@erp.local', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
    const finance = await makeUser('Finance');
    financeToken = await login(app, finance.email, finance.password);
  });

  afterAll(async () => {
    await cleanupRun();
    await app.close();
    await prisma.$disconnect();
  });

  /** Create a DRAFT invoice for a customer, tagged for cleanup. */
  async function draftInvoice(customerId: string, total: number) {
    const res = await request(app.getHttpServer())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId, currency: 'MYR', taxPct: 0, notes: tag('invoice'),
        items: [{ description: 'E2E freight', unitPrice: total, quantity: 1 }],
      })
      .expect(201);
    return res.body.id as string;
  }

  const issue = (id: string, token: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(`/api/invoices/${id}/issue`).set('Authorization', `Bearer ${token}`).send(body);

  it('issues normally when the customer is under their limit', async () => {
    const c = await makeCustomer({ label: 'under-limit', creditLimit: 10000 });
    const id = await draftInvoice(c.id, 2000);
    const res = await issue(id, adminToken).expect(201);
    expect(res.body.status).toBe('ISSUED');
  });

  it('blocks with 409 when the invoice would exceed the limit', async () => {
    const c = await makeCustomer({ label: 'over-limit', creditLimit: 5000 });
    const first = await draftInvoice(c.id, 4000);
    await issue(first, adminToken).expect(201);

    const second = await draftInvoice(c.id, 2000);
    const res = await issue(second, adminToken).expect(409);
    expect(res.body.message).toMatch(/Credit limit exceeded/);
    expect(res.body.message).toMatch(/MYR 6000\.00/); // projected
    expect(res.body.message).toMatch(/MYR 1000\.00/); // shortfall

    const after = await prisma.invoice.findUnique({ where: { id: second } });
    expect(after?.status).toBe('DRAFT'); // refused, not partially applied
  });

  it('allows issuing right up to the limit exactly (boundary)', async () => {
    const c = await makeCustomer({ label: 'exact-limit', creditLimit: 5000 });
    const first = await draftInvoice(c.id, 3000);
    await issue(first, adminToken).expect(201);
    const second = await draftInvoice(c.id, 2000);
    await issue(second, adminToken).expect(201);
  });

  it('applies the tighter operational limit (D-4)', async () => {
    const c = await makeCustomer({ label: 'min-limit', creditLimit: 100000, outstandingLimit: 1000 });
    const id = await draftInvoice(c.id, 1500);
    const res = await issue(id, adminToken).expect(409);
    expect(res.body.message).toMatch(/MYR 1000\.00/);
  });

  it('never blocks a customer with no limit configured (null ≠ zero)', async () => {
    const c = await makeCustomer({ label: 'no-limit' });
    const id = await draftInvoice(c.id, 999999);
    await issue(id, adminToken).expect(201);
  });

  it('blocks a customer on credit hold even at a zero balance (D-5)', async () => {
    const c = await makeCustomer({ label: 'on-hold', creditHold: true });
    const id = await draftInvoice(c.id, 1);
    const res = await issue(id, adminToken).expect(409);
    expect(res.body.message).toMatch(/on credit hold/);
  });

  it('records the block in the audit log with the figures', async () => {
    const c = await makeCustomer({ label: 'audit-block', creditLimit: 100 });
    const id = await draftInvoice(c.id, 500);
    await issue(id, adminToken).expect(409);
    const entry = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'CREDIT_BLOCK' }, orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect((entry?.detail as Record<string, unknown>)?.effectiveLimit).toBe(100);
  });

  describe('override (D-7)', () => {
    it('lets an Administrator issue past the block with a reason, and audits it', async () => {
      const c = await makeCustomer({ label: 'override-ok', creditLimit: 100 });
      const id = await draftInvoice(c.id, 500);
      await issue(id, adminToken).expect(409);
      const res = await issue(id, adminToken, { creditOverrideReason: 'director approved' }).expect(201);
      expect(res.body.status).toBe('ISSUED');

      const entry = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'CREDIT_OVERRIDE' } });
      expect((entry?.detail as Record<string, unknown>)?.reason).toBe('director approved');
    });

    it('refuses the override for a user who can issue invoices but lacks credit.override (403)', async () => {
      const c = await makeCustomer({ label: 'override-denied', creditLimit: 100 });
      const id = await draftInvoice(c.id, 500);
      // Finance passes the route guard (invoices.write) and is then stopped by
      // the override check — proving the two rights are genuinely separate.
      const res = await issue(id, financeToken, { creditOverrideReason: 'let me through' }).expect(403);
      expect(res.body.message).toMatch(/permission to override/);
      const after = await prisma.invoice.findUnique({ where: { id } });
      expect(after?.status).toBe('DRAFT');
    });

    it('stops a Sales user at the route guard — they cannot issue at all', async () => {
      const c = await makeCustomer({ label: 'sales-denied', creditLimit: 100 });
      const id = await draftInvoice(c.id, 500);
      const res = await issue(id, salesToken, { creditOverrideReason: 'let me through' }).expect(403);
      expect(res.body.message).toMatch(/Missing permission: invoices.write/);
    });

    it('rejects a blank override reason at the validation pipe', async () => {
      const c = await makeCustomer({ label: 'blank-reason', creditLimit: 100 });
      const id = await draftInvoice(c.id, 500);
      await issue(id, adminToken, { creditOverrideReason: '' }).expect(400);
    });

    it('rejects an unknown field on the issue body (forbidNonWhitelisted)', async () => {
      const c = await makeCustomer({ label: 'unknown-field', creditLimit: 100000 });
      const id = await draftInvoice(c.id, 10);
      await issue(id, adminToken, { bogusField: 'x' }).expect(400);
    });
  });

  describe('D-2 — only invoice issue is gated', () => {
    it('does not block creating a DRAFT invoice for an over-limit customer', async () => {
      const c = await makeCustomer({ label: 'draft-allowed', creditLimit: 1 });
      await expect(draftInvoice(c.id, 50000)).resolves.toBeTruthy();
    });

    it('does not block recording a payment for a customer on credit hold', async () => {
      const c = await makeCustomer({ label: 'payment-allowed', creditHold: false, creditLimit: 100000 });
      const id = await draftInvoice(c.id, 1000);
      await issue(id, adminToken).expect(201);
      await prisma.customer.update({ where: { id: c.id }, data: { creditHold: true } });

      await request(app.getHttpServer())
        .post(`/api/invoices/${id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 400 })
        .expect(201);
    });
  });

  describe('exposure endpoint', () => {
    it('reports exposure net of payments and issued credit notes', async () => {
      const c = await makeCustomer({ label: 'exposure', creditLimit: 100000 });
      const id = await draftInvoice(c.id, 1000);
      await issue(id, adminToken).expect(201);
      await request(app.getHttpServer())
        .post(`/api/invoices/${id}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 250 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/customers/${c.id}/credit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.exposure).toBe(750);
      expect(res.body.effectiveLimit).toBe(100000);
      expect(res.body.headroom).toBe(99250);
    });

    it('lists over-limit customers in the dry-run report', async () => {
      const c = await makeCustomer({ label: 'dryrun', creditLimit: 100 });
      const id = await draftInvoice(c.id, 500);
      await issue(id, adminToken, { creditOverrideReason: 'seed the over-limit state' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/customers/credit/over-limit')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const row = res.body.rows.find((r: { customerId: string }) => r.customerId === c.id);
      expect(row).toBeTruthy();
      expect(row.wouldBlock).toBe(true);
      expect(row.overBy).toBe(400);
    });
  });
});
