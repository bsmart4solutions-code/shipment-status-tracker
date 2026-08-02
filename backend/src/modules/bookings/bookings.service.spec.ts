import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/**
 * Sprint 06 / P0-4 — booking lifecycle, with stubbed dependencies (no
 * database), mirroring the style of invoices.service.spec.ts.
 *
 * The concurrency guarantee (two simultaneous confirmations must not create
 * two jobs) is deliberately NOT tested here: these stubs have no transactions
 * and no unique constraints, so a mock could only prove the mock. It is
 * asserted over real HTTP against real Postgres in
 * test/booking-confirm.e2e-spec.ts — the same lesson Sprint 04 learned when
 * the integration layer found a real AP race unit tests could not see.
 */

const QUOTE = {
  id: 'q-1', currency: 'MYR', totalCost: 1000, sellingPrice: 1590, taxAmt: 90, grossProfit: 500,
  pol: 'MYPKG', pod: 'CNSHA',
  items: [
    { vendorId: 'v-small', totalCost: 200 },
    { vendorId: 'v-big', totalCost: 800 },
  ],
};

function makeService(opts: {
  booking?: Record<string, unknown> | null;
  existingJob?: { jobNumber: string } | null;
}) {
  const created: Record<string, unknown>[] = [];
  const trackingRows: Record<string, unknown>[] = [];
  const bookingUpdates: Record<string, unknown>[] = [];

  const tx = {
    job: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'job-1', ...data };
      }),
    },
    jobTrackingEvent: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { trackingRows.push(data); return data; }) },
    booking: { update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { bookingUpdates.push(data); return data; }) },
    auditLog: { create: jest.fn(async () => undefined) },
  };

  const prisma = {
    booking: {
      findUnique: jest.fn(async () => opts.booking ?? null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { bookingUpdates.push(data); return data; }),
    },
    job: { findUnique: jest.fn(async () => opts.existingJob ?? null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const service = new BookingsService(
    prisma as never,
    { next: jest.fn(async () => 'JOB-2026-0009') } as never,
    { log: jest.fn(async () => undefined) } as never,
  );
  return { service, created, trackingRows, bookingUpdates, prisma };
}

const draftBooking = {
  id: 'b-1', bookingNumber: 'BKG-2026-0001', status: 'DRAFT', customerId: 'c-1', quotationId: 'q-1',
  vendorId: null, currency: 'MYR', origin: 'MYPKG', destination: 'CNSHA', etd: null, eta: null,
  quotation: QUOTE, jobs: [],
};

describe('Booking confirm — opens the shipment file', () => {
  it('creates a job carrying the quotation commercials, net of SST', async () => {
    const { service, created } = makeService({ booking: draftBooking });
    await service.confirm('b-1', 'user-1');
    // 1590 gross − 90 tax = 1500 revenue; profit stays revenue − cost.
    expect(created[0]).toMatchObject({
      jobNumber: 'JOB-2026-0009', customerId: 'c-1', quotationId: 'q-1', bookingId: 'b-1',
      actualCost: 1000, actualRevenue: 1500, profit: 500, status: 'OPEN', milestone: 'BOOKED',
    });
  });

  it('starts the shipment at the BOOKED milestone and records it on the timeline', async () => {
    const { service, trackingRows } = makeService({ booking: draftBooking });
    await service.confirm('b-1', 'user-1');
    expect(trackingRows[0]).toMatchObject({ status: 'BOOKED', source: 'SYSTEM' });
  });

  it('flips the booking to CONFIRMED', async () => {
    const { service, bookingUpdates } = makeService({ booking: draftBooking });
    await service.confirm('b-1', 'user-1');
    expect(bookingUpdates).toContainEqual({ status: 'CONFIRMED' });
  });

  it('picks the quotation line with the largest cost share as the primary vendor', async () => {
    const { service, created } = makeService({ booking: draftBooking });
    await service.confirm('b-1', 'user-1');
    expect(created[0].vendorId).toBe('v-big');
  });

  it("prefers the booking's own carrier over the quotation's largest-cost vendor", async () => {
    const { service, created } = makeService({ booking: { ...draftBooking, vendorId: 'v-carrier' } });
    await service.confirm('b-1', 'user-1');
    expect(created[0].vendorId).toBe('v-carrier');
  });

  it('opens a zero-value job for a booking with no quotation behind it (spot business)', async () => {
    const { service, created } = makeService({ booking: { ...draftBooking, quotationId: null, quotation: null } });
    await service.confirm('b-1', 'user-1');
    expect(created[0]).toMatchObject({ actualCost: 0, actualRevenue: 0, profit: 0, quotationId: null });
  });

  it('refuses to confirm twice — the second attempt sees the existing job', async () => {
    const { service } = makeService({ booking: draftBooking, existingJob: { jobNumber: 'JOB-2026-0009' } });
    await expect(service.confirm('b-1')).rejects.toThrow(ConflictException);
    await expect(service.confirm('b-1')).rejects.toThrow(/already opened shipment file JOB-2026-0009/);
  });

  it('refuses to confirm a cancelled booking', async () => {
    const { service } = makeService({ booking: { ...draftBooking, status: 'CANCELLED' } });
    await expect(service.confirm('b-1')).rejects.toThrow(/cannot change from CANCELLED to CONFIRMED/);
  });
});

describe('Booking edit and cancel guards', () => {
  it('refuses to edit a confirmed booking — a shipment file exists behind it', async () => {
    const { service } = makeService({ booking: { status: 'CONFIRMED' } });
    await expect(service.update('b-1', {} as never)).rejects.toThrow(BadRequestException);
    await expect(service.update('b-1', {} as never)).rejects.toThrow(/Cannot edit a CONFIRMED booking/);
  });

  it('refuses to cancel a booking whose shipment file is still live', async () => {
    const { service } = makeService({
      booking: { ...draftBooking, status: 'CONFIRMED', jobs: [{ jobNumber: 'JOB-2026-0009', status: 'OPEN' }] },
    });
    await expect(service.cancel('b-1', 'changed our mind')).rejects.toThrow(ConflictException);
    await expect(service.cancel('b-1', 'changed our mind')).rejects.toThrow(/cancel the job first/);
  });

  it('allows cancelling once the shipment file itself is cancelled', async () => {
    const { service, bookingUpdates } = makeService({
      booking: { ...draftBooking, status: 'CONFIRMED', jobs: [{ jobNumber: 'JOB-2026-0009', status: 'CANCELLED' }] },
    });
    await service.cancel('b-1', 'shipment cancelled');
    expect(bookingUpdates).toContainEqual({ status: 'CANCELLED' });
  });

  it('allows cancelling a draft booking that never opened a file', async () => {
    const { service, bookingUpdates } = makeService({ booking: draftBooking });
    await service.cancel('b-1', undefined);
    expect(bookingUpdates).toContainEqual({ status: 'CANCELLED' });
  });
});
