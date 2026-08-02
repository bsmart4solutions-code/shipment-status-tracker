import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma.service';
import { requestContext } from '../../common/request-context';
import { SequenceService } from '../../common/sequence.service';
import { assertBookingStatusTransition, assertQuotationStatusTransition } from '../../common/state-machine';
import { assertApprovalAllows } from '../quotations/approval.logic';
import { CreateBookingDto, UpdateBookingDto } from './bookings.dto';

/**
 * Booking (Sprint 06, P0-4) — the forwarding step between winning a quotation
 * and operating a shipment file.
 *
 * `confirm()` is the pivot: it is what creates the Job, taking over the role
 * `QuotationsService.convertToJob()` used to play. The commercial figures are
 * still copied from the quotation (not re-derived), and the same
 * unique-constraint + P2002 race guard protects against a double-submit
 * creating two jobs.
 */
@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private seq: SequenceService,
    private audit: AuditService,
  ) {}

  async list(dto: PaginationDto & { status?: string; customerId?: string; vendorId?: string }) {
    const where: Prisma.BookingWhereInput = {};
    if (dto.search) {
      where.OR = [
        { bookingNumber: { contains: dto.search, mode: 'insensitive' } },
        { carrierBookingNo: { contains: dto.search, mode: 'insensitive' } },
        { carrier: { contains: dto.search, mode: 'insensitive' } },
        { customer: { companyName: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }
    if (dto.status) where.status = dto.status as never;
    if (dto.customerId) where.customerId = dto.customerId;
    if (dto.vendorId) where.vendorId = dto.vendorId;

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          customer: { select: { companyName: true, code: true } },
          vendor: { select: { name: true } },
          quotation: { select: { quoteNumber: true } },
          jobs: { select: { id: true, jobNumber: true, milestone: true } },
        },
        orderBy: { bookingDate: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return paged(items, total, dto);
  }

  async get(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        customer: true,
        vendor: true,
        quotation: { select: { id: true, quoteNumber: true, status: true, sellingPrice: true, currency: true } },
        jobs: { select: { id: true, jobNumber: true, status: true, milestone: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private mapDates(dto: CreateBookingDto | UpdateBookingDto): Record<string, unknown> {
    const { bookingDate, siCutoff, vgmCutoff, cyCutoff, etd, eta, ...rest } = dto;
    const d = (v?: string) => (v ? new Date(v) : undefined);
    return { ...rest, bookingDate: d(bookingDate), siCutoff: d(siCutoff), vgmCutoff: d(vgmCutoff), cyCutoff: d(cyCutoff), etd: d(etd), eta: d(eta) };
  }

  /** Standalone booking (spot business with no quotation behind it). */
  async create(dto: CreateBookingDto, userId?: string) {
    const bookingNumber = await this.seq.next('booking');
    const booking = await this.prisma.booking.create({
      data: { ...this.mapDates(dto), bookingNumber, createdById: userId } as Prisma.BookingUncheckedCreateInput,
    });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'booking', entityId: booking.id, detail: { bookingNumber } });
    return booking;
  }

  /**
   * Raise a booking off a won quotation — the entry point that replaced
   * `POST /quotations/:id/convert`. Winning the deal and booking it are the
   * same moment commercially, so this marks the quotation WON in the same
   * transaction.
   */
  async createFromQuotation(quotationId: string, userId?: string) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      select: {
        id: true, quoteNumber: true, status: true, approvalStatus: true, customerId: true,
        currency: true, pol: true, pod: true,
      },
    });
    if (!quote) throw new NotFoundException('Quotation not found');
    // Booking implies a WON transition; the state machine stays the single
    // source of truth for which statuses may reach WON (blocks CANCELLED/LOST).
    assertQuotationStatusTransition(quote.status, 'WON');
    assertApprovalAllows('WON', quote.approvalStatus);

    // Fail fast with a friendly message; the unique constraint is the race-safe
    // backstop below.
    const existing = await this.prisma.booking.findUnique({
      where: { quotationId },
      select: { bookingNumber: true },
    });
    if (existing) {
      throw new ConflictException(`Quotation is already booked (${existing.bookingNumber})`);
    }

    const bookingNumber = await this.seq.next('booking');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            bookingNumber,
            quotationId: quote.id,
            customerId: quote.customerId,
            currency: quote.currency,
            // Carry the lane so operations sees it without opening the quote.
            origin: quote.pol,
            destination: quote.pod,
            status: 'DRAFT',
            createdById: userId,
          },
        });
        if (quote.status !== 'WON') await tx.quotation.update({ where: { id: quotationId }, data: { status: 'WON' } });
        const ctx = requestContext.getStore();
        await tx.auditLog.create({
          data: {
            userId, action: 'BOOK', entityType: 'quotation', entityId: quotationId,
            detail: { bookingNumber, quoteNumber: quote.quoteNumber }, ip: ctx?.ip, userAgent: ctx?.userAgent,
          },
        });
        return booking;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Quotation was already booked');
      }
      throw e;
    }
  }

  /** Only DRAFT bookings are editable — once CONFIRMED a shipment file exists behind it. */
  async update(id: string, dto: UpdateBookingDto, userId?: string) {
    const existing = await this.prisma.booking.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw new NotFoundException('Booking not found');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot edit a ${existing.status} booking`);
    }
    const booking = await this.prisma.booking.update({
      where: { id },
      data: this.mapDates(dto) as Prisma.BookingUncheckedUpdateInput,
    });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'booking', entityId: id });
    return booking;
  }

  /**
   * Confirm the booking with the carrier and open the shipment file.
   *
   * This is the single place a Job is created from a booking. The commercials
   * come from the quotation exactly as `convertToJob` copied them (net of SST,
   * so actualRevenue − actualCost still equals profit); the lane, carrier and
   * dates come from the booking, which is more current than the quote.
   */
  async confirm(id: string, userId?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        quotation: {
          select: {
            id: true, currency: true, totalCost: true, sellingPrice: true, taxAmt: true, grossProfit: true,
            pol: true, pod: true,
            items: { select: { vendorId: true, totalCost: true } },
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    assertBookingStatusTransition(booking.status, 'CONFIRMED');

    const existingJob = await this.prisma.job.findUnique({
      where: { bookingId: id },
      select: { jobNumber: true },
    });
    if (existingJob) {
      throw new ConflictException(`Booking already opened shipment file ${existingJob.jobNumber}`);
    }

    const quote = booking.quotation;
    // Primary vendor: the booking's carrier when set, otherwise the quotation
    // line carrying the largest cost share (the rule convertToJob used).
    let primaryVendorId = booking.vendorId;
    if (!primaryVendorId && quote) {
      const vendorTotals = new Map<string, number>();
      for (const item of quote.items) {
        if (item.vendorId) vendorTotals.set(item.vendorId, (vendorTotals.get(item.vendorId) ?? 0) + Number(item.totalCost));
      }
      primaryVendorId = [...vendorTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }

    const jobNumber = await this.seq.next('job');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: {
            jobNumber,
            customerId: booking.customerId,
            quotationId: booking.quotationId,
            bookingId: booking.id,
            vendorId: primaryVendorId,
            currency: booking.currency,
            actualCost: quote?.totalCost ?? 0,
            // Net of SST: sellingPrice is the tax-inclusive grand total, but
            // collected tax is not revenue.
            actualRevenue: quote ? Number(quote.sellingPrice) - Number(quote.taxAmt) : 0,
            profit: quote?.grossProfit ?? 0,
            origin: booking.origin ?? quote?.pol ?? null,
            destination: booking.destination ?? quote?.pod ?? null,
            etd: booking.etd,
            eta: booking.eta,
            status: 'OPEN',
            // The shipment is, by definition, now booked.
            milestone: 'BOOKED',
          },
        });
        await tx.jobTrackingEvent.create({
          data: {
            jobId: job.id,
            status: 'BOOKED',
            description: `Booking ${booking.bookingNumber} confirmed`,
            source: 'SYSTEM',
            createdById: userId,
          },
        });
        await tx.booking.update({ where: { id }, data: { status: 'CONFIRMED' } });
        const ctx = requestContext.getStore();
        await tx.auditLog.create({
          data: {
            userId, action: 'CONFIRM', entityType: 'booking', entityId: id,
            detail: { bookingNumber: booking.bookingNumber, jobNumber }, ip: ctx?.ip, userAgent: ctx?.userAgent,
          },
        });
        return job;
      });
    } catch (e) {
      // Concurrent double-confirm: the unique constraint on jobId fired.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Booking was already confirmed');
      }
      throw e;
    }
  }

  /**
   * Cancel a booking. A confirmed booking with a live shipment file behind it
   * is refused — the same rule that stops an invoice being cancelled while
   * notes exist against it. Cancel the job first, then the booking.
   */
  async cancel(id: string, reason: string | undefined, userId?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { jobs: { select: { jobNumber: true, status: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const liveJob = booking.jobs.find((j) => j.status !== 'CANCELLED');
    if (liveJob) {
      throw new ConflictException(
        `Cannot cancel a booking with an active shipment file (${liveJob.jobNumber}) — cancel the job first`,
      );
    }
    assertBookingStatusTransition(booking.status, 'CANCELLED');
    const updated = await this.prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({
      userId, action: 'STATUS', entityType: 'booking', entityId: id,
      detail: { from: booking.status, to: 'CANCELLED', reason },
    });
    return updated;
  }
}
