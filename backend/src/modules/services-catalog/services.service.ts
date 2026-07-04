import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { SequenceService } from '../../common/sequence.service';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService, private seq: SequenceService) {}

  list() {
    return this.prisma.service.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { rates: true } } } });
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

  async remove(id: string) {
    try {
      await this.prisma.service.delete({ where: { id } });
    } catch (e) {
      rethrowPrisma(e, 'Service', 'Service has vendor rates or is used on quotations — set status to INACTIVE instead of deleting');
    }
    return { deleted: true };
  }
}
