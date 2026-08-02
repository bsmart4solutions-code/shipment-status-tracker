import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { assertJobStatusTransition, assertMilestoneTransition, MILESTONE_SEQUENCE, MilestoneStatus } from '../../common/state-machine';
import { AddTrackingEventDto, AdvanceMilestoneDto, CreateJobDto, UpdateJobDto } from './jobs.dto';

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

  /**
   * Advance the shipment's operational milestone (Sprint 06, P0-4).
   *
   * Distinct from `addTrackingEvent`: milestones are a fixed forward-only
   * sequence validated by the state machine, and the current position is
   * persisted on the job so list/dashboard queries never have to replay the
   * event history. Each advance still writes a SYSTEM tracking row, so the
   * timeline remains the full record of how the shipment got here.
   */
  async advanceMilestone(jobId: string, dto: AdvanceMilestoneDto, userId?: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, deletedAt: null },
      select: { id: true, status: true, milestone: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status === 'CANCELLED') {
      throw new BadRequestException('Cannot advance milestones on a cancelled job');
    }
    assertMilestoneTransition(job.milestone, dto.milestone);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({ where: { id: jobId }, data: { milestone: dto.milestone } });
      await tx.jobTrackingEvent.create({
        data: {
          jobId,
          status: dto.milestone,
          location: dto.location,
          description: dto.description ?? `Milestone: ${dto.milestone.replace(/_/g, ' ')}`,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          source: 'SYSTEM',
          createdById: userId,
        },
      });
      return updated;
    });
  }

  /** The milestone that may legally be reached next, or null at the end. */
  static nextMilestone(current: MilestoneStatus | null): MilestoneStatus | null {
    if (current === null) return 'BOOKED';
    const i = MILESTONE_SEQUENCE.indexOf(current);
    return i >= 0 && i < MILESTONE_SEQUENCE.length - 1 ? MILESTONE_SEQUENCE[i + 1] : null;
  }

  /**
   * Shipments currently in transit, with the milestone they are waiting on.
   * Powers the dashboard operations panel.
   */
  async inTransit(limit = 10) {
    const jobs = await this.prisma.job.findMany({
      where: {
        deletedAt: null,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        // `not: 'DELIVERED'` alone would silently drop rows where milestone is
        // NULL (SQL: NULL != 'DELIVERED' is NULL, not TRUE) — i.e. every job
        // not yet booked, which is exactly what operations most needs to see.
        OR: [{ milestone: null }, { milestone: { not: 'DELIVERED' } }],
      },
      include: { customer: { select: { companyName: true } } },
      orderBy: [{ eta: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return jobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      customer: j.customer.companyName,
      origin: j.origin,
      destination: j.destination,
      etd: j.etd,
      eta: j.eta,
      milestone: j.milestone,
      nextMilestone: JobsService.nextMilestone(j.milestone as MilestoneStatus | null),
    }));
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
}
