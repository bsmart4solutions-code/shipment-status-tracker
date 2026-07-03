import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';

const SAFE_SELECT = { id: true, email: true, fullName: true, isActive: true, roleId: true, role: { select: { name: true } }, createdAt: true };

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({ select: SAFE_SELECT, orderBy: { fullName: 'asc' } });
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: { email: dto.email, fullName: dto.fullName, roleId: dto.roleId, passwordHash },
      select: SAFE_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const data: Record<string, unknown> = { fullName: dto.fullName, roleId: dto.roleId, isActive: dto.isActive };
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    const user = await this.prisma.user.update({ where: { id }, data, select: SAFE_SELECT }).catch(() => null);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
