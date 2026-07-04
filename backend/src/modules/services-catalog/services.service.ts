import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { SequenceService } from '../../common/sequence.service';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService, private seq: SequenceService) {}

  list() {
    return this.prisma.service.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, include: { _count: { select: { rates: true } } } });
  }

  async create(name: string, description?: string) {
    const code = await this.seq.next('service');
    return this.prisma.service.create({ data: { name, description, code } });
  }

  async update(id: string, data: { name?: string; description?: string; status?: 'ACTIVE' | 'INACTIVE' }) {
    try {
      return await this.prisma.service.update({ where: { id }, data });
    } catch (e) {
      rethrowPrisma(e, 'Service');
    }
  }

  /** Soft delete — moves the service to the recycle bin, restorable. */
  async remove(id: string) {
    const existing = await this.prisma.service.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Service not found');
    await this.prisma.service.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }
}
