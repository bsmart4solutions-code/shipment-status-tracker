import { HealthController } from './health.controller';

/**
 * H-1 regression: /health must report the ACTIVE storage driver so "local"
 * appearing in production (documents on the ephemeral disk) is monitorable,
 * not just a one-line boot log.
 */
describe('HealthController — storage driver reporting', () => {
  function makeController(driverName: string, dbOk = true) {
    const prisma = {
      $queryRaw: dbOk ? jest.fn(async () => [{ '?column?': 1 }]) : jest.fn(async () => { throw new Error('db down'); }),
    };
    const metrics = { snapshot: jest.fn(() => ({})) };
    const storage = { driverName };
    return new HealthController(prisma as never, metrics as never, storage as never);
  }

  it('reports the active storage driver in the full health payload', async () => {
    const res = await makeController('s3').health();
    expect(res.checks.storageDriver).toBe('s3');
    expect(res.status).toBe('ok');
  });

  it('reports "local" when the local driver is active', async () => {
    const res = await makeController('local').health();
    expect(res.checks.storageDriver).toBe('local');
  });

  it('keeps reporting the driver even when the database is down (degraded)', async () => {
    const res = await makeController('s3', false).health();
    expect(res.status).toBe('degraded');
    expect(res.checks.storageDriver).toBe('s3');
  });

  it('liveness endpoint stays untouched (API compatibility)', () => {
    const res = makeController('s3').live();
    expect(res).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
  });
});
