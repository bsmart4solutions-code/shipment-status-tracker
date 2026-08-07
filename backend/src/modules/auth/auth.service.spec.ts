import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * The only security boundary in the system, and until now the only module with
 * no unit tests at all. The integration suite exercises the happy path over
 * real HTTP, but never the parts that matter most here: the lockout counter,
 * what happens on the attempt that crosses the threshold, and whether a lock
 * actually expires. Those are asserted directly.
 *
 * Stubbed dependencies, no database — mirroring bookings.service.spec.ts.
 * bcrypt is real (not mocked): password comparison is the one thing in this
 * file that must not be taken on faith from a stub.
 */

const PASSWORD = 'Correct@123';
// Cost 4 keeps the suite fast; the algorithm under test is unaffected.
const HASH = bcrypt.hashSync(PASSWORD, 4);

type UserOverrides = {
  isActive?: boolean;
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
  passwordHash?: string;
};

function makeUser(o: UserOverrides = {}) {
  return {
    id: 'u-1',
    email: 'ops@erp.local',
    fullName: 'Ops User',
    passwordHash: o.passwordHash ?? HASH,
    isActive: o.isActive ?? true,
    failedLoginAttempts: o.failedLoginAttempts ?? 0,
    lockedUntil: o.lockedUntil ?? null,
    role: {
      name: 'Finance',
      permissions: [
        { permission: { code: 'invoices.read' } },
        { permission: { code: 'invoices.write' } },
      ],
    },
  };
}

function makeService(user: ReturnType<typeof makeUser> | null) {
  // Mirrors Prisma's behaviour for `{ increment: 1 }` closely enough that the
  // threshold arithmetic under test is the real thing.
  const updates: Record<string, unknown>[] = [];
  let attempts = user?.failedLoginAttempts ?? 0;

  const prisma = {
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        updates.push(data);
        if (data.failedLoginAttempts?.increment) {
          attempts += data.failedLoginAttempts.increment;
        } else if (typeof data.failedLoginAttempts === 'number') {
          attempts = data.failedLoginAttempts;
        }
        return { failedLoginAttempts: attempts };
      }),
    },
  };

  const audit = { log: jest.fn(async () => undefined) };
  const jwt = { sign: jest.fn(() => 'signed.jwt.token') };

  const service = new AuthService(prisma as never, jwt as never, audit as never);
  return { service, prisma, audit, jwt, updates };
}

describe('AuthService.login', () => {
  describe('rejects without leaking which part was wrong', () => {
    it('unknown email fails with the generic message', async () => {
      const { service, audit } = makeService(null);

      await expect(service.login('nobody@erp.local', PASSWORD)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGIN_FAILED', detail: expect.objectContaining({ reason: 'unknown_email' }) }),
      );
    });

    it('a deactivated user fails with the SAME message as an unknown email', async () => {
      const { service, audit } = makeService(makeUser({ isActive: false }));

      // Identical wording is the point: a different message would let an
      // attacker enumerate which addresses are real accounts.
      await expect(service.login('ops@erp.local', PASSWORD)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ detail: expect.objectContaining({ reason: 'inactive' }) }),
      );
    });

    it('a deactivated user is refused even with the correct password', async () => {
      const { service, jwt } = makeService(makeUser({ isActive: false }));

      await expect(service.login('ops@erp.local', PASSWORD)).rejects.toThrow(UnauthorizedException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('a wrong password is refused', async () => {
      const { service, jwt } = makeService(makeUser());

      await expect(service.login('ops@erp.local', 'WrongPassword!')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe('lockout counter', () => {
    it('counts a failure up without locking below the threshold', async () => {
      const { service, updates } = makeService(makeUser({ failedLoginAttempts: 0 }));

      await expect(service.login('ops@erp.local', 'nope')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );

      expect(updates[0]).toEqual({ failedLoginAttempts: { increment: 1 } });
      // No lock written while under the threshold.
      expect(updates.some((u) => 'lockedUntil' in u)).toBe(false);
    });

    it('locks the account on the 5th consecutive failure, and says so', async () => {
      // 4 already recorded; this attempt is the 5th.
      const { service, updates } = makeService(makeUser({ failedLoginAttempts: 4 }));

      await expect(service.login('ops@erp.local', 'nope')).rejects.toThrow(
        new UnauthorizedException('Too many failed attempts — account locked for 15 minutes'),
      );

      const lock = updates.find((u) => 'lockedUntil' in u) as { lockedUntil: Date; failedLoginAttempts: number };
      expect(lock).toBeDefined();
      expect(lock.lockedUntil.getTime()).toBeGreaterThan(Date.now());
      // Counter resets when the lock is applied, so the next window starts clean.
      expect(lock.failedLoginAttempts).toBe(0);
    });

    it('does not lock one attempt early', async () => {
      // 3 recorded; this is the 4th — still one short.
      const { service, updates } = makeService(makeUser({ failedLoginAttempts: 3 }));

      await expect(service.login('ops@erp.local', 'nope')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(updates.some((u) => 'lockedUntil' in u)).toBe(false);
    });

    it('increments atomically rather than writing a computed value', async () => {
      // A read-then-write would lose counts when failures land concurrently.
      const { service, updates } = makeService(makeUser({ failedLoginAttempts: 2 }));

      await expect(service.login('ops@erp.local', 'nope')).rejects.toThrow(UnauthorizedException);
      expect(updates[0]).toEqual({ failedLoginAttempts: { increment: 1 } });
      expect(updates[0]).not.toEqual({ failedLoginAttempts: 3 });
    });
  });

  describe('while locked', () => {
    it('refuses even the CORRECT password and reports the minutes left', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60000);
      const { service, jwt, audit } = makeService(makeUser({ lockedUntil }));

      await expect(service.login('ops@erp.local', PASSWORD)).rejects.toThrow(
        /Account temporarily locked — try again in 10 minutes/,
      );
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_BLOCKED' }));
    });

    it('says "1 minute", not "1 minutes"', async () => {
      const { service } = makeService(makeUser({ lockedUntil: new Date(Date.now() + 30_000) }));

      await expect(service.login('ops@erp.local', PASSWORD)).rejects.toThrow(
        /try again in 1 minute$/,
      );
    });

    it('lets the user back in once the lock has expired', async () => {
      // Lock in the past: the guard must not fire.
      const { service, jwt } = makeService(
        makeUser({ lockedUntil: new Date(Date.now() - 60_000), failedLoginAttempts: 0 }),
      );

      const result = await service.login('ops@erp.local', PASSWORD);
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(jwt.sign).toHaveBeenCalled();
    });
  });

  describe('successful login', () => {
    it('issues a token carrying the user id and email as the subject', async () => {
      const { service, jwt } = makeService(makeUser());

      const result = await service.login('ops@erp.local', PASSWORD);

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u-1', email: 'ops@erp.local' });
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('returns the role and its permission codes, and never the password hash', async () => {
      const { service } = makeService(makeUser());

      const result = await service.login('ops@erp.local', PASSWORD);

      expect(result.user).toEqual({
        id: 'u-1',
        email: 'ops@erp.local',
        fullName: 'Ops User',
        role: 'Finance',
        permissions: ['invoices.read', 'invoices.write'],
      });
      expect(JSON.stringify(result)).not.toContain(HASH);
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('clears stale failure state after a partial run of failures', async () => {
      const { service, updates } = makeService(makeUser({ failedLoginAttempts: 3 }));

      await service.login('ops@erp.local', PASSWORD);

      expect(updates).toContainEqual({ failedLoginAttempts: 0, lockedUntil: null });
    });

    it('writes nothing when there was no failure state to clear', async () => {
      const { service, updates } = makeService(makeUser({ failedLoginAttempts: 0, lockedUntil: null }));

      await service.login('ops@erp.local', PASSWORD);

      // Avoids a pointless UPDATE on every single login.
      expect(updates).toHaveLength(0);
    });

    it('audit-logs the login against the user', async () => {
      const { service, audit } = makeService(makeUser());

      await service.login('ops@erp.local', PASSWORD);

      expect(audit.log).toHaveBeenCalledWith({
        userId: 'u-1', action: 'LOGIN', entityType: 'user', entityId: 'u-1',
      });
    });
  });

  describe('password hashing', () => {
    it('accepts the password only against its real bcrypt hash', async () => {
      // Guards against the hash ever being compared as a plain string.
      const { service } = makeService(makeUser({ passwordHash: bcrypt.hashSync('Different@123', 4) }));

      await expect(service.login('ops@erp.local', PASSWORD)).rejects.toThrow(UnauthorizedException);
    });

    it('does not treat the stored hash itself as a valid password', async () => {
      const { service } = makeService(makeUser());

      await expect(service.login('ops@erp.local', HASH)).rejects.toThrow(UnauthorizedException);
    });
  });
});
