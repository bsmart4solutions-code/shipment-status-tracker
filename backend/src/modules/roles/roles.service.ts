import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
  }

  permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  /** Replace a role's permission set (configurable RBAC). */
  async setPermissions(roleId: string, permissionIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) }),
    ]);
    return this.prisma.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  }

  create(name: string, description?: string) {
    return this.prisma.role.create({ data: { name, description } });
  }
}
