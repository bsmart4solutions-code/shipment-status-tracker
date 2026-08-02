import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const JOB_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;

// The global ValidationPipe runs with forbidNonWhitelisted, so list filters must
// be declared on the DTO — extra @Query() params would be rejected (was the bug
// tracked in TODO.md).
export class ListJobsDto extends PaginationDto {
  @IsOptional() @IsIn(JOB_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
}

export class CreateJobDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsUUID() quotationId?: string;
  @IsOptional() @IsDateString() shipmentDate?: string;
  @IsOptional() @IsDateString() etd?: string;
  @IsOptional() @IsDateString() eta?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsString() trackingNumber?: string;
  @IsOptional() @IsIn(JOB_STATUSES as unknown as string[]) status?: (typeof JOB_STATUSES)[number];
  @IsOptional() @IsNumber() actualCost?: number;
  @IsOptional() @IsNumber() actualRevenue?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateJobDto extends CreateJobDto {
  @IsOptional() @IsUUID() declare customerId: string;
}

export class AddTrackingEventDto {
  @IsString() status: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

const MILESTONES = ['BOOKED', 'GATED_IN', 'LOADED', 'DEPARTED', 'ARRIVED', 'DELIVERED'] as const;

/**
 * Advancing the operational milestone (Sprint 06, P0-4). Deliberately separate
 * from AddTrackingEventDto: a milestone is a validated step in a fixed
 * sequence, whereas a tracking event is free-text commentary.
 */
export class AdvanceMilestoneDto {
  @IsIn(MILESTONES as unknown as string[]) milestone: (typeof MILESTONES)[number];
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}
