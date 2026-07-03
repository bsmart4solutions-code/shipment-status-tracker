import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { assertJobStatusTransition } from '../../common/state-machine';
import { AddDocumentDto, CreateJobDto, UpdateJobDto } from './jobs.dto';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService, private seq: SequenceService) {}

  async list(dto: PaginationDto & { status?: string; customerId?: string; vendorId?: string; origin?: string; destination?: string }) {
    const where: Prisma.JobWhereInput = {};
    if (dto.search) {
      where.OR = [
        { jobNumber: { contains: dto.search, mode: 'insensitive' } },
        { trackingNumber: { contains: dto.search, mode: 'insensitive' } },
        { customer: { companyName: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }
    if (dto.status) where.status = dto.status as never;
    if (dto.customerId) where.customerId = dto.customerId;
    if (dto.vendorId) where.vendorId = dto.vendorId;
    if (dto.origin) where.origin = { contains: dto.origin, mode: 'insensitive' };
    if (dto.destination) where.destination = { contains: dto.destination, mode: 'insensitive' };
    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        include: {
          customer: { select: { companyName: true } },
          vendor: { select: { name: true } },
          quotation: { select: { quoteNumber: true } },
          _count: { select: { documents: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);
    return paged(items, total, dto);
  }

  async get(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        customer: true,
        vendor: true,
        quotation: { include: { items: { include: { service: { select: { name: true } } } } } },
        documents: { orderBy: { uploadedAt: 'desc' } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async create(dto: CreateJobDto) {
    const jobNumber = await this.seq.next('job');
    const profit = (dto.actualRevenue ?? 0) - (dto.actualCost ?? 0);
    return this.prisma.job.create({
      data: { ...this.mapDates(dto), jobNumber, profit } as Prisma.JobUncheckedCreateInput,
    });
  }

  async update(id: string, dto: UpdateJobDto) {
    const existing = await this.prisma.job.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Job not found');
    if (dto.status) assertJobStatusTransition(existing.status, dto.status);
    const actualCost = dto.actualCost ?? Number(existing.actualCost);
    const actualRevenue = dto.actualRevenue ?? Number(existing.actualRevenue);
    return this.prisma.job.update({
      where: { id },
      data: { ...this.mapDates(dto), profit: actualRevenue - actualCost } as Prisma.JobUncheckedUpdateInput,
    });
  }

  private mapDates(dto: CreateJobDto | UpdateJobDto): Record<string, unknown> {
    const { shipmentDate, etd, eta, ...rest } = dto;
    return {
      ...rest,
      shipmentDate: shipmentDate ? new Date(shipmentDate) : undefined,
      etd: etd ? new Date(etd) : undefined,
      eta: eta ? new Date(eta) : undefined,
    };
  }

  async remove(id: string) {
    await this.prisma.job.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Job not found');
    });
    return { deleted: true };
  }

  addDocument(jobId: string, dto: AddDocumentDto) {
    return this.prisma.jobDocument.create({ data: { ...dto, jobId } });
  }

  async removeDocument(id: string) {
    await this.prisma.jobDocument.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Document not found');
    });
    return { deleted: true };
  }
}
