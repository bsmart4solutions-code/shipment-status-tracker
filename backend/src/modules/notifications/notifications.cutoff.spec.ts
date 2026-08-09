import { NotificationsService } from './notifications.service';

/**
 * Booking cut-off alerting (Sprint 07).
 *
 * The behaviour that matters is WHEN the alert fires. A missed SI cut-off
 * means the container does not sail, so an alert that arrives afterwards —
 * the way the overdue-invoice alert legitimately does — would be useless.
 * These tests pin the lead time, the daily repeat, and the point at which a
 * missed cut-off stops nagging.
 */

const H = 3600000;
const D = 86400000;

type Booking = {
  id: string;
  bookingNumber: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  siCutoff?: Date | null;
  vgmCutoff?: Date | null;
  cyCutoff?: Date | null;
};

type Pushed = { type: string; title: string; message: string; dedupeKey: string };

/** Captures pushed notifications; every other scan branch returns nothing. */
function makeService(bookings: Booking[], settings: Record<string, unknown> = {}) {
  const pushed: Pushed[] = [];
  const seenKeys = new Set<string>();

  const prisma = {
    quotation: { findMany: jest.fn(async () => []) },
    vendorServiceRate: { findMany: jest.fn(async () => []) },
    job: { findMany: jest.fn(async () => []) },
    invoice: { findMany: jest.fn(async () => []), update: jest.fn() },
    booking: {
      findMany: jest.fn(async (_args?: { where?: Record<string, unknown> }) =>
        bookings.map((b) => ({
          siCutoff: null, vgmCutoff: null, cyCutoff: null,
          ...b,
          customer: { companyName: 'Acme Sdn Bhd' },
        })),
      ),
    },
    notification: {
      create: jest.fn(async ({ data }: { data: { dedupeKey: string } & Record<string, string> }) => {
        // Mirrors the real unique index on dedupeKey: a duplicate is rejected,
        // and the service swallows that as "already alerted".
        if (seenKeys.has(data.dedupeKey)) throw new Error('unique violation');
        seenKeys.add(data.dedupeKey);
        pushed.push(data as never);
        return data;
      }),
    },
  };

  const settingsSvc = {
    get: jest.fn(async (key: string, fallback: unknown) => settings[key] ?? fallback),
  };
  const mail = { send: jest.fn(async () => ({ simulated: true })) };

  const service = new NotificationsService(prisma as never, settingsSvc as never, mail as never);
  return { service, pushed, prisma };
}

const cutoffAlerts = (pushed: Pushed[]) => pushed.filter((p) => p.type === 'BOOKING_CUTOFF');

describe('NotificationsService — booking cut-offs', () => {
  it('alerts BEFORE the deadline, which is the whole point', async () => {
    const { service, pushed } = makeService([
      { id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED', siCutoff: new Date(Date.now() + 12 * H) },
    ]);

    await service.scan();

    const alerts = cutoffAlerts(pushed);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('SI cut-off approaching');
    expect(alerts[0].message).toMatch(/BKG-2026-0001/);
    expect(alerts[0].message).toMatch(/in 12h/);
  });

  it('still reports a cut-off that has already passed, and says so', async () => {
    const { service, pushed } = makeService([
      { id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED', vgmCutoff: new Date(Date.now() - 5 * H) },
    ]);

    await service.scan();

    const alerts = cutoffAlerts(pushed);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('VGM cut-off missed');
    expect(alerts[0].message).toMatch(/5h ago/);
  });

  it('raises one alert per cut-off type on the same booking', async () => {
    // SI, VGM and CY are separate deadlines with separate consequences —
    // collapsing them into one alert would hide which is at risk.
    const { service, pushed } = makeService([
      {
        id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED',
        siCutoff: new Date(Date.now() + 6 * H),
        vgmCutoff: new Date(Date.now() + 20 * H),
        cyCutoff: new Date(Date.now() + 30 * H),
      },
    ]);

    await service.scan();

    const titles = cutoffAlerts(pushed).map((a) => a.title).sort();
    expect(titles).toEqual([
      'CY cut-off approaching', 'SI cut-off approaching', 'VGM cut-off approaching',
    ]);
  });

  it('does not alert on a cut-off beyond the configured window', async () => {
    const { service, pushed } = makeService([
      { id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED', siCutoff: new Date(Date.now() + 10 * D) },
    ]);

    await service.scan();
    expect(cutoffAlerts(pushed)).toHaveLength(0);
  });

  it('honours a configured lead time instead of the 48h default', async () => {
    const at = new Date(Date.now() + 5 * D);
    const wide = makeService(
      [{ id: 'b1', bookingNumber: 'BKG-1', status: 'CONFIRMED', siCutoff: at }],
      { 'alerts.bookingCutoffHours': 24 * 7 },
    );
    await wide.service.scan();
    expect(cutoffAlerts(wide.pushed)).toHaveLength(1);

    const narrow = makeService([{ id: 'b1', bookingNumber: 'BKG-1', status: 'CONFIRMED', siCutoff: at }]);
    await narrow.service.scan();
    expect(cutoffAlerts(narrow.pushed)).toHaveLength(0);
  });

  it('stops nagging about a cut-off missed long ago', async () => {
    // Past the point where re-booking or a late-SI exception is realistic.
    const { service, pushed } = makeService([
      { id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED', siCutoff: new Date(Date.now() - 10 * D) },
    ]);

    await service.scan();
    expect(cutoffAlerts(pushed)).toHaveLength(0);
  });

  it('repeats daily rather than once, but not twice in the same day', async () => {
    // A single alert scrolls out of the notification list unseen; an hourly
    // one trains people to ignore it. The scan runs every 30 minutes, so the
    // dedupe key is what makes the cadence daily.
    const { service, pushed } = makeService([
      { id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED', siCutoff: new Date(Date.now() + 8 * H) },
    ]);

    await service.scan();
    await service.scan();
    await service.scan();

    expect(cutoffAlerts(pushed)).toHaveLength(1);
    expect(cutoffAlerts(pushed)[0].dedupeKey).toMatch(/^CUTOFF:b1:SI:\d+$/);
  });

  it('keys the dedupe per cut-off type so SI and VGM do not suppress each other', async () => {
    const { service, pushed } = makeService([
      {
        id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED',
        siCutoff: new Date(Date.now() + 6 * H),
        vgmCutoff: new Date(Date.now() + 6 * H), // identical instant
      },
    ]);

    await service.scan();

    const keys = cutoffAlerts(pushed).map((a) => a.dedupeKey).sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/:SI:/);
    expect(keys[1]).toMatch(/:VGM:/);
  });

  it('queries only DRAFT and CONFIRMED bookings — a cancelled one has no deadline', async () => {
    const { service, prisma } = makeService([]);
    await service.scan();

    const args = prisma.booking.findMany.mock.calls[0]?.[0];
    expect(args?.where?.status).toEqual({ in: ['DRAFT', 'CONFIRMED'] });
  });

  it('leaves the other alert types alone', async () => {
    const { service, pushed } = makeService([
      { id: 'b1', bookingNumber: 'BKG-2026-0001', status: 'CONFIRMED', siCutoff: new Date(Date.now() + 6 * H) },
    ]);

    const result = await service.scan();

    expect(result.scanned).toBe(true);
    expect(pushed.every((p) => p.type === 'BOOKING_CUTOFF')).toBe(true);
  });
});
