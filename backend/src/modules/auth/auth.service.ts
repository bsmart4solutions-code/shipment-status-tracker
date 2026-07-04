import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';

// Account-level lockout: complements the per-IP throttle (which an attacker
// can dodge by rotating IPs). After MAX_FAILED_ATTEMPTS wrong passwords the
// account locks for LOCK_MINUTES regardless of source IP.
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private audit: AuditService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });

    if (!user || !user.isActive) {
      await this.audit.log({ action: 'LOGIN_FAILED', entityType: 'user', detail: { email, reason: user ? 'inactive' : 'unknown_email' } });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await this.audit.log({ userId: user.id, action: 'LOGIN_BLOCKED', entityType: 'user', entityId: user.id, detail: { email, lockedUntil: user.lockedUntil.toISOString() } });
      throw new UnauthorizedException(`Account temporarily locked — try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}`);
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      // Atomic increment so concurrent failures can't lose counts.
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      const locked = updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS;
      if (locked) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) },
        });
      }
      await this.audit.log({
        userId: user.id, action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id,
        detail: { email, attempt: updated.failedLoginAttempts, locked },
      });
      throw new UnauthorizedException(
        locked ? `Too many failed attempts — account locked for ${LOCK_MINUTES} minutes` : 'Invalid credentials',
      );
    }

    // Success: clear any stale failure state.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }
    await this.audit.log({ userId: user.id, action: 'LOGIN', entityType: 'user', entityId: user.id });
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      user: {
        id: user.id, email: user.email, fullName: user.fullName, role: user.role.name,
        permissions: user.role.permissions.map((p) => p.permission.code),
      },
    };
  }
}
