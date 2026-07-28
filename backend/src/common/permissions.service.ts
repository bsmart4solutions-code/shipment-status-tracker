import { Injectable } from '@nestjs/common';
import { PermissionCode } from './permissions';
import { PrismaService } from './prisma.service';

export interface RequestUser {
  id: string;
  roleId: string;
  roleName: string;
}

/**
 * Single owner of "does this user hold this permission".
 *
 * Route-level checks go through PermissionsGuard; a few flows also need the
 * answer *inside* a service — issuing an invoice past a credit block, for
 * example, is allowed only for holders of `credit.override`. Both consume this
 * service rather than each resolving roles themselves, so there is one
 * implementation and one cache.
 */
@Injectable()
export class PermissionsService {
  private cache = new Map<string, { codes: Set<string>; expires: number }>();

  constructor(private prisma: PrismaService) {}

  /** Permission codes for a role, cached for 30s to avoid a query per request. */
  async codesForRole(roleId: string): Promise<Set<string>> {
    const cached = this.cache.get(roleId);
    if (cached && cached.expires > Date.now()) return cached.codes;
    const rows = await this.prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } });
    const codes = new Set(rows.map((r) => r.permission.code));
    this.cache.set(roleId, { codes, expires: Date.now() + 30_000 });
    return codes;
  }

  /** Administrator bypasses all checks, matching the route guard exactly. */
  async userHas(user: RequestUser | undefined, code: PermissionCode): Promise<boolean> {
    if (!user) return false;
    if (user.roleName === 'Administrator') return true;
    const codes = await this.codesForRole(user.roleId);
    return codes.has(code);
  }
}
