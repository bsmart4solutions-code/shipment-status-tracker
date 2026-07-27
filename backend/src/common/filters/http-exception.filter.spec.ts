import { BadRequestException, ConflictException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

/**
 * Sprint 03A — Prisma P2002 (unique constraint) must surface as an actionable
 * 409, not a 500. This path is reached when a check-then-insert loses a race,
 * so the client sees the same conflict the service's own check would have
 * produced.
 */
function run(exception: unknown) {
  const json = jest.fn();
  const res = { status: jest.fn((_code: number) => ({ json })) };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ path: '/api/payables' }),
    }),
  };
  new AllExceptionsFilter().catch(exception, host as never);
  return { status: res.status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

const p2002 = (target: unknown) => Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });

describe('AllExceptionsFilter — Prisma unique constraint mapping', () => {
  it('maps a partial-index violation to 409 with re-entry guidance', () => {
    const { status, body } = run(p2002('vendor_bills_vendor_invoice_active_key'));
    expect(status).toBe(409);
    expect(body.message).toMatch(/already recorded on an active bill/);
    expect(body.message).toMatch(/void that bill first/);
  });

  it('accepts the index name delivered as a single-element array', () => {
    const { status, body } = run(p2002(['vendor_bills_vendor_invoice_active_key']));
    expect(status).toBe(409);
    expect(body.message).toMatch(/already recorded on an active bill/);
  });

  it('names a single conflicting column in plain language', () => {
    const { status, body } = run(p2002(['billNumber']));
    expect(status).toBe(409);
    expect(body.message).toBe('A record with this bill number already exists');
  });

  it('lists several conflicting columns readably', () => {
    const { body } = run(p2002(['code', 'email']));
    expect(body.message).toBe('A record with this code and email address already exists');
  });

  it('falls back to a generic conflict for unknown columns', () => {
    const { status, body } = run(p2002(['someInternalColumn']));
    expect(status).toBe(409);
    expect(body.message).toBe('A record with these details already exists');
  });

  it('leaves ordinary HttpExceptions untouched', () => {
    expect(run(new BadRequestException('bad input')).status).toBe(400);
    expect(run(new ConflictException('already there')).status).toBe(409);
  });

  it('still reports a genuine failure as 500', () => {
    const { status } = run(new Error('database on fire'));
    expect(status).toBe(500);
  });

  it('ignores non-P2002 Prisma errors', () => {
    const { status } = run(Object.assign(new Error('not found'), { code: 'P2025' }));
    expect(status).toBe(500);
  });
});
