import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const BOOKING_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'];

// The global ValidationPipe runs with forbidNonWhitelisted, so list filters must
// be declared on the DTO — extra @Query() params would be rejected.
export class ListBookingsDto extends PaginationDto {
  @IsOptional() @IsIn(BOOKING_STATUSES) status?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
}

export class CreateBookingDto {
  @IsUUID() customerId: string;
  /** Optional: a booking may be raised without a quotation (spot business). */
  @IsOptional() @IsUUID() quotationId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsString() carrier?: string;
  @IsOptional() @IsString() carrierBookingNo?: string;
  @IsOptional() @IsDateString() bookingDate?: string;
  @IsOptional() @IsDateString() siCutoff?: string;
  @IsOptional() @IsDateString() vgmCutoff?: string;
  @IsOptional() @IsDateString() cyCutoff?: string;
  @IsOptional() @IsDateString() etd?: string;
  @IsOptional() @IsDateString() eta?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateBookingDto extends CreateBookingDto {
  @IsOptional() @IsUUID() declare customerId: string;
}

export class CancelBookingDto {
  @IsOptional() @IsString() reason?: string;
}
