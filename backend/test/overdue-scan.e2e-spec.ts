import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { cleanupRun, createTestApp, login, makeCustomer, prisma, tag } from './setup';

/**
 * Overdue-invoice scan (Sprint 05, P0-8) — idempotency over real HTTP.
 *
 * The scan is designed to run on a schedule (`@Cron`) and is also exposed
 * manually via POST /api/notifications/scan. It must be safe to run twice in
 * a row: the in-app alert is deduped by a unique `dedupeKey`, and the reminder
 * email is gated by `Invoice.lastReminderAt` staying fresh — both are real
 * database state, not something a mocked Prisma client can prove.
 */
describe('Overdue invoice scan over real HTTP (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let invoiceId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app, 'admin@erp.local', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
  });

  afterAll(async () => {
    if (invoiceId) await prisma.notification.deleteMany({ where: { entityType: 'invoice', entityId: invoiceId } });
    await cleanupRun();
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());

  it('running the scan twice does not double-alert or re-send the reminder', async () => {
    const c = await makeCustomer({ label: 'overdue-scan' });
    // makeCustomer() doesn't set an email — give this one so the reminder-email
    // path (gated on lastReminderAt) is actually exercised, not skipped.
    await prisma.customer.update({ where: { id: c.id }, data: { email: `${c.code.toLowerCase()}@e2e.example` } });
    const pastDue = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const created = await http().post('/api/invoices').set(auth())
      .send({
        customerId: c.id, currency: 'MYR', taxPct: 0, dueDate: pastDue, notes: tag('overdue'),
        items: [{ description: 'freight', unitPrice: 500, quantity: 1 }],
      })
      .expect(201);
    invoiceId = created.body.id;
    await http().post(`/api/invoices/${invoiceId}/issue`).set(auth()).send({}).expect(201);

    await http().post('/api/notifications/scan').set(auth()).expect(201);
    const afterFirst = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(afterFirst?.lastReminderAt).not.toBeNull();
    const alertsAfterFirst = await prisma.notification.count({ where: { entityType: 'invoice', entityId: invoiceId } });
    expect(alertsAfterFirst).toBe(1);

    await http().post('/api/notifications/scan').set(auth()).expect(201);
    const afterSecond = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    // Reminder was sent < 7 days ago, so the second run must not touch it again.
    expect(afterSecond?.lastReminderAt?.getTime()).toBe(afterFirst?.lastReminderAt?.getTime());
    // dedupeKey is scoped per ISO week, so a second run in the same week must
    // not create a second alert for the same invoice.
    const alertsAfterSecond = await prisma.notification.count({ where: { entityType: 'invoice', entityId: invoiceId } });
    expect(alertsAfterSecond).toBe(1);
  });
});
