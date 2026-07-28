import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permissions.decorator';
import { PermissionCode } from '../permissions';
import { PermissionsService } from '../permissions.service';

/**
 * Enforces the permission declared via @RequirePermission on the route.
 *
 * Role resolution, the Administrator bypass and the 30s cache live in
 * PermissionsService so that in-service checks (the credit override at invoice
 * issue) apply exactly the same rules — one implementation, one cache.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private permissions: PermissionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionCode>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (await this.permissions.userHas(user, required)) return true;
    throw new ForbiddenException(`Missing permission: ${required}`);
  }
}
