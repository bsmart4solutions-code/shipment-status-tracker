import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }

  /** Payload set at login: { sub, email }. Re-load role each request so revoked users drop instantly. */
  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return { id: user.id, email: user.email, fullName: user.fullName, roleId: user.roleId, roleName: user.role.name };
  }
}
