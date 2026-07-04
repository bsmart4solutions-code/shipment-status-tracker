import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { assertJobStatusTransition } from '../../common/state-machine';
import { AddDocumentDto, AddTrackingEventDto, CreateJobDto, UpdateJobDto } from './jobs.dto';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService, private seq: SequenceService) {}

  async list(dto: PaginationDto & { status?: string; customerId?: string; vendorId?: string; origin?: string; destination?: string }) {
    const where: Prisma.JobWhereInput = { deletedAt: null };
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
        tracking: { orderBy: { occurredAt: 'asc' }, include: { createdBy: { select: { fullName: true } } } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async create(dto: CreateJobDto) {
    const jobNumber = await this.seq.next('job');
    const profit = (dto.actualRevenue ?? 0) - (dto.actualCost ?? 0);
    const status = dto.status ?? 'OPEN';
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: { ...this.mapDates(dto), jobNumber, profit, status } as Prisma.JobUncheckedCreateInput,
      });
      await tx.jobTrackingEvent.create({
        data: { jobId: job.id, status, description: 'Job created', source: 'SYSTEM' },
      });
      return job;
    });
  }

  async update(id: string, dto: UpdateJobDto) {
    const existing = await this.prisma.job.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Job not found');
    if (dto.status) assertJobStatusTransition(existing.status, dto.status);
    const actualCost = dto.actualCost ?? Number(existing.actualCost);
    const actualRevenue = dto.actualRevenue ?? Number(existing.actualRevenue);
    const statusChanged = !!dto.status && dto.status !== existing.status;

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id },
        data: { ...this.mapDates(dto), profit: actualRevenue - actualCost } as Prisma.JobUncheckedUpdateInput,
      });
      if (statusChanged) {
        await tx.jobTrackingEvent.create({
          data: { jobId: id, status: dto.status!, description: `Status changed: ${existing.status} → ${dto.status}`, source: 'SYSTEM' },
        });
      }
      return job;
    });
  }

  /** Chronological tracking timeline for a job (oldest first). */
  async listTracking(jobId: string) {
    const exists = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Job not found');
    return this.prisma.jobTrackingEvent.findMany({
      where: { jobId },
      orderBy: { occurredAt: 'asc' },
      include: { createdBy: { select: { fullName: true } } },
    });
  }

  /** Manually logged milestone (e.g. "Departed origin port") independent of the job's OPEN/IN_PROGRESS/... status. */
  async addTrackingEvent(jobId: string, dto: AddTrackingEventDto, userId?: string) {
    const exists = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Job not found');
    return this.prisma.jobTrackingEvent.create({
      data: {
        jobId,
        status: dto.status,
        location: dto.location,
        description: dto.description,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        source: 'MANUAL',
        createdById: userId,
      },
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

  /** Soft delete — moves the job to the recycle bin, restorable. */
  async remove(id: string) {
    const existing = await this.prisma.job.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Job not found');
    await this.prisma.job.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  addDocument(jobId: string, dto: AddDocumentDto) {
    return this.prisma.jobDocument.create({ data: { ...dto, jobId } });
  }

  async removeDocument(id: string) {
    try {
      await this.prisma.jobDocument.delete({ where: { id } });
    } catch (e) {
      rethrowPrisma(e, 'Document');
    }
    return { deleted: true };
  }
}
