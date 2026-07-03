import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
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

  update(id: string, data: { name?: string; description?: string; status?: 'ACTIVE' | 'INACTIVE' }) {
    return this.prisma.service.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException('Service not found');
    });
  }

  async remove(id: string) {
    await this.prisma.service.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Service not found');
    });
    return { deleted: true };
  }
}
