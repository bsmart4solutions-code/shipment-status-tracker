import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber,
  IsOptional, IsPositive, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const BILL_STATUSES = ['DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

// The global ValidationPipe runs with forbidNonWhitelisted, so list filters must
// be declared on the DTO — extra @Query() params would be rejected (the bug
// still open on quotations/invoices/jobs, see TODO.md).
export class ListPayablesDto extends PaginationDto {
  @IsOptional() @IsIn(BILL_STATUSES) status?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() jobId?: string;
}

export class VendorBillItemDto {
  @IsString() @IsNotEmpty() description: string;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsOptional() @IsString() lineCurrency?: string;
  @IsOptional() @IsNumber() @IsPositive() fxRate?: number;
  @IsOptional() @IsBoolean() taxExempt?: boolean;
  @IsOptional() @IsString() accNo?: string;
  /** Line-level job allocation, overriding the bill header. */
  @IsOptional() @IsUUID() jobId?: string;
}

export class CreateVendorBillDto {
  @IsUUID() vendorId: string;
  // Required: duplicate control is keyed on (vendorId, vendorInvoiceNo) and
  // cannot work on blank values.
  @IsString() @IsNotEmpty({ message: "The vendor's invoice number is required" })
  vendorInvoiceNo: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsDateString() billDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1, { message: 'Add at least one line before saving the bill' })
  @ValidateNested({ each: true }) @Type(() => VendorBillItemDto)
  items: VendorBillItemDto[];
}

export class UpdateVendorBillDto {
  @IsOptional() @IsString() @IsNotEmpty() vendorInvoiceNo?: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsDateString() billDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() notes?: string;
  // Replacing the lines may never leave the bill empty.
  @IsOptional() @IsArray() @ArrayMinSize(1, { message: 'A bill must keep at least one line' })
  @ValidateNested({ each: true }) @Type(() => VendorBillItemDto)
  items?: VendorBillItemDto[];
}

export class RecordVendorPaymentDto {
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() reference?: string;
}

export class ReverseVendorPaymentDto {
  // Mandatory: cash movement is never unwound anonymously.
  @IsString() @IsNotEmpty({ message: 'A reason is required to reverse a payment' })
  reason: string;
}

export class VoidVendorBillDto {
  @IsOptional() @IsString() reason?: string;
}
