import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { CreateUserDto, UpdateUserDto } from './users.dto';

const SAFE_SELECT = { id: true, email: true, fullName: true, phone: true, isActive: true, roleId: true, role: { select: { name: true } }, createdAt: true };

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list() {
    return this.prisma.user.findMany({ select: SAFE_SELECT, orderBy: { fullName: 'asc' } });
  }

  async create(dto: CreateUserDto, actorId?: string) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, fullName: dto.fullName, phone: dto.phone, roleId: dto.roleId, passwordHash },
      select: SAFE_SELECT,
    });
    await this.audit.log({ userId: actorId, action: 'CREATE', entityType: 'user', entityId: user.id, detail: { email: user.email, roleId: user.roleId } });
    return user;
  }

  /**
   * Role reassignment and activation toggles are privilege changes — the
   * audit entry records what changed, from what, to what.
   */
  async update(id: string, dto: UpdateUserDto, actorId?: string) {
    const existing = await this.prisma.user.findUnique({ where: { id }, select: { fullName: true, roleId: true, isActive: true, email: true } });
    if (!existing) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = { fullName: dto.fullName, phone: dto.phone, roleId: dto.roleId, isActive: dto.isActive };
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

    try {
      const user = await this.prisma.user.update({ where: { id }, data, select: SAFE_SELECT });
      const before: Record<string, string | boolean | null> = {};
      const after: Record<string, string | boolean | null> = {};
      for (const k of ['fullName', 'roleId', 'isActive'] as const) {
        if (dto[k] !== undefined && dto[k] !== existing[k]) {
          before[k] = existing[k];
          after[k] = dto[k];
        }
      }
      await this.audit.log({
        userId: actorId, action: 'UPDATE', entityType: 'user', entityId: id,
        detail: { email: existing.email, before, after, passwordChanged: !!dto.password },
      });
      return user;
    } catch (e) {
      rethrowPrisma(e, 'User', 'Referenced role does not exist');
    }
  }
}
