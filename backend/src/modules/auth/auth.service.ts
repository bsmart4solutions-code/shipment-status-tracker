import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'user', entityId: user.id } });
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      user: {
        id: user.id, email: user.email, fullName: user.fullName, role: user.role.name,
        permissions: user.role.permissions.map((p) => p.permission.code),
      },
    };
  }
}
