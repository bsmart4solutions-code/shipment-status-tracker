import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

const JOB_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;

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

export class AddDocumentDto {
  @IsString() name: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() url?: string;
}
