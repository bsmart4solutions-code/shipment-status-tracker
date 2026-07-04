import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list() {
    return this.prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
  }

  permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  /**
   * Replace a role's permission set (configurable RBAC). Privilege changes
   * are a prime escalation surface, so the before/after permission codes go
   * into the audit log.
   */
  async setPermissions(roleId: string, permissionIds: string[], actorId?: string) {
    const before = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) }),
    ]);
    const after = await this.prisma.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    await this.audit.log({
      userId: actorId, action: 'PERMISSIONS_CHANGE', entityType: 'role', entityId: roleId,
      detail: {
        role: after?.name,
        before: before?.permissions.map((p) => p.permission.code).sort() ?? [],
        after: after?.permissions.map((p) => p.permission.code).sort() ?? [],
      },
    });
    return after;
  }

  async create(name: string, description?: string, actorId?: string) {
    const role = await this.prisma.role.create({ data: { name, description } });
    await this.audit.log({ userId: actorId, action: 'CREATE', entityType: 'role', entityId: role.id, detail: { name } });
    return role;
  }
}
