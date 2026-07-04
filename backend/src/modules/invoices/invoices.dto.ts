import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsNumber() @Min(0) subtotal: number;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateInvoiceDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) subtotal?: number;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class RecordPaymentDto {
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() reference?: string;
}
