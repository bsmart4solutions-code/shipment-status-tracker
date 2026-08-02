import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, CreateBookingDto, ListBookingsDto, UpdateBookingDto } from './bookings.dto';

/**
 * Bookings (Sprint 06, P0-4). Guarded by its own `bookings.*` scope: raising
 * and confirming a carrier booking is an operational duty distinct from
 * quoting (`quotations.*`) and from running the shipment file (`jobs.*`).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Get() @RequirePermission('bookings.read')
  list(@Query() dto: ListBookingsDto) {
    return this.bookings.list(dto);
  }

  // Declared before ':id' so the literal segment is never captured as an id.
  @Post('from-quotation/:quotationId') @RequirePermission('bookings.write')
  createFromQuotation(@Param('quotationId') quotationId: string, @CurrentUser() user: { id: string }) {
    return this.bookings.createFromQuotation(quotationId, user.id);
  }

  @Get(':id') @RequirePermission('bookings.read')
  get(@Param('id') id: string) { return this.bookings.get(id); }

  @Post() @RequirePermission('bookings.write')
  create(@Body() dto: CreateBookingDto, @CurrentUser() user: { id: string }) {
    return this.bookings.create(dto, user.id);
  }

  @Patch(':id') @RequirePermission('bookings.write')
  update(@Param('id') id: string, @Body() dto: UpdateBookingDto, @CurrentUser() user: { id: string }) {
    return this.bookings.update(id, dto, user.id);
  }

  /** Confirm with the carrier and open the shipment file (creates the Job). */
  @Post(':id/confirm') @RequirePermission('bookings.write')
  confirm(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.bookings.confirm(id, user.id);
  }

  @Post(':id/cancel') @RequirePermission('bookings.write')
  cancel(@Param('id') id: string, @Body() dto: CancelBookingDto, @CurrentUser() user: { id: string }) {
    return this.bookings.cancel(id, dto.reason, user.id);
  }
}
