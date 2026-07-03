import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../prisma.service';

/**
 * Enforces the permission declared via @RequirePermission on the route.
 * Administrator role bypasses all checks. Permissions per role are
 * cached for 30s to avoid a query on every request.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private cache = new Map<string, { codes: Set<string>; expires: number }>();

  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.roleName === 'Administrator') return true;

    const codes = await this.permissionsForRole(user.roleId);
    if (!codes.has(required)) throw new ForbiddenException(`Missing permission: ${required}`);
    return true;
  }

  private async permissionsForRole(roleId: string): Promise<Set<string>> {
    const cached = this.cache.get(roleId);
    if (cached && cached.expires > Date.now()) return cached.codes;
    const rows = await this.prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } });
    const codes = new Set(rows.map((r) => r.permission.code));
    this.cache.set(roleId, { codes, expires: Date.now() + 30_000 });
    return codes;
  }
}
