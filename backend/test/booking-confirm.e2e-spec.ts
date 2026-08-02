import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { cleanupRun, createTestApp, login, makeCustomer, prisma, tag } from './setup';

/**
 * Booking → shipment file (Sprint 06, P0-4) over real HTTP.
 *
 * The load-bearing case is the concurrency one. Confirming a booking creates a
 * Job, guarded by a unique constraint on `jobs.bookingId` and a P2002 → 409
 * mapping — exactly the shape of guard whose absence Sprint 04's integration
 * layer exposed in Accounts Payable. A mocked Prisma has no unique index, so
 * only a real database can prove two simultaneous confirmations cannot open
 * two shipment files against one booking.
 */
describe('Booking confirmation over real HTTP (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const createdBookingIds: string[] = [];
  const createdJobIds: string[] = [];
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app, 'admin@erp.local', process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
  });

  afterAll(async () => {
    // Jobs reference bookings, so clear the jobs this suite opened first.
    const fromBookings = createdBookingIds.length
      ? (await prisma.job.findMany({ where: { bookingId: { in: createdBookingIds } }, select: { id: true } })).map((j) => j.id)
      : [];
    const jobIds = [...new Set([...fromBookings, ...createdJobIds])];
    if (jobIds.length) {
      await prisma.jobTrackingEvent.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    }
    if (createdBookingIds.length) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdBookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    }
    await cleanupRun();
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());

  async function draftBooking(customerId: string) {
    const res = await http().post('/api/bookings').set(auth())
      .send({ customerId, carrier: 'E2E Line', origin: 'MYPKG', destination: 'CNSHA', notes: tag('booking') })
      .expect(201);
    createdBookingIds.push(res.body.id);
    return res.body.id as string;
  }

  it('confirming a booking opens exactly one shipment file at the BOOKED milestone', async () => {
    const c = await makeCustomer({ label: 'booking-confirm' });
    const bookingId = await draftBooking(c.id);

    const res = await http().post(`/api/bookings/${bookingId}/confirm`).set(auth()).expect(201);
    expect(res.body.milestone).toBe('BOOKED');
    expect(res.body.bookingId).toBe(bookingId);

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe('CONFIRMED');
  });

  it('two simultaneous confirmations cannot open two shipment files', async () => {
    const c = await makeCustomer({ label: 'booking-race' });
    const bookingId = await draftBooking(c.id);

    const results = await Promise.allSettled([
      http().post(`/api/bookings/${bookingId}/confirm`).set(auth()),
      http().post(`/api/bookings/${bookingId}/confirm`).set(auth()),
    ]);
    const codes = results
      .map((r) => (r.status === 'fulfilled' ? (r.value as { status: number }).status : 0))
      .sort();
    // One succeeds (201), the other is refused as already-confirmed (409).
    expect(codes).toEqual([201, 409]);

    const jobs = await prisma.job.findMany({ where: { bookingId } });
    expect(jobs).toHaveLength(1); // never two
  });

  it('milestones advance one step at a time and never backwards', async () => {
    const c = await makeCustomer({ label: 'booking-milestones' });
    const bookingId = await draftBooking(c.id);
    const job = await http().post(`/api/bookings/${bookingId}/confirm`).set(auth()).expect(201);
    const jobId = job.body.id;

    // Skipping ahead is refused.
    const skip = await http().post(`/api/jobs/${jobId}/milestone`).set(auth())
      .send({ milestone: 'DEPARTED' }).expect(400);
    expect(skip.body.message).toMatch(/one step at a time/);

    // The legal next step is accepted, and lands on the job.
    await http().post(`/api/jobs/${jobId}/milestone`).set(auth()).send({ milestone: 'GATED_IN' }).expect(201);
    const advanced = await prisma.job.findUnique({ where: { id: jobId } });
    expect(advanced?.milestone).toBe('GATED_IN');

    // Going backwards is refused.
    const back = await http().post(`/api/jobs/${jobId}/milestone`).set(auth())
      .send({ milestone: 'BOOKED' }).expect(400);
    expect(back.body.message).toMatch(/never go backwards/);

    // Every advance leaves a SYSTEM row on the timeline.
    const events = await prisma.jobTrackingEvent.findMany({ where: { jobId }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.status)).toEqual(['BOOKED', 'GATED_IN']);
  });

  /**
   * Regression, found during MVP GA live verification: filtering with
   * `milestone: { not: 'DELIVERED' }` alone silently dropped every job whose
   * milestone is NULL, because SQL evaluates `NULL != 'DELIVERED'` as NULL
   * rather than TRUE. That hid exactly the shipments operations most needs —
   * the ones not yet booked. Only a real database exhibits this; a mocked
   * Prisma would happily have "passed".
   */
  it('in-transit includes shipments that have no milestone yet (SQL NULL semantics)', async () => {
    const c = await makeCustomer({ label: 'in-transit-null' });
    const job = await http().post('/api/jobs').set(auth())
      .send({ customerId: c.id, origin: 'MYPKG', destination: 'SGSIN', notes: tag('job') })
      .expect(201);
    createdJobIds.push(job.body.id);
    expect(job.body.milestone).toBeNull();

    const res = await http().get('/api/jobs/in-transit').set(auth()).expect(200);
    const row = res.body.find((r: { id: string }) => r.id === job.body.id);
    expect(row).toBeDefined();
    // The panel tells operations what to do next: book it.
    expect(row.nextMilestone).toBe('BOOKED');
  });

  it('in-transit excludes shipments already delivered', async () => {
    const c = await makeCustomer({ label: 'in-transit-delivered' });
    const bookingId = await draftBooking(c.id);
    const job = await http().post(`/api/bookings/${bookingId}/confirm`).set(auth()).expect(201);
    for (const m of ['GATED_IN', 'LOADED', 'DEPARTED', 'ARRIVED', 'DELIVERED']) {
      await http().post(`/api/jobs/${job.body.id}/milestone`).set(auth()).send({ milestone: m }).expect(201);
    }
    const res = await http().get('/api/jobs/in-transit').set(auth()).expect(200);
    expect(res.body.find((r: { id: string }) => r.id === job.body.id)).toBeUndefined();
  });

  it('a booking with a live shipment file cannot be cancelled', async () => {
    const c = await makeCustomer({ label: 'booking-cancel-guard' });
    const bookingId = await draftBooking(c.id);
    await http().post(`/api/bookings/${bookingId}/confirm`).set(auth()).expect(201);

    const res = await http().post(`/api/bookings/${bookingId}/cancel`).set(auth()).send({}).expect(409);
    expect(res.body.message).toMatch(/cancel the job first/);
  });
});
