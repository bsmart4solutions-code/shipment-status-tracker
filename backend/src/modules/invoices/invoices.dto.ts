import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID,
  Min, ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

// The global ValidationPipe runs with forbidNonWhitelisted, so list filters must
// be declared on the DTO — extra @Query() params would be rejected (was the bug
// tracked in TODO.md).
export class ListInvoicesDto extends PaginationDto {
  @IsOptional() @IsIn(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']) status?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() jobId?: string;
}

export class InvoiceItemDto {
  @IsString() description: string;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsOptional() @IsString() lineCurrency?: string;
  @IsOptional() @IsNumber() @IsPositive() fxRate?: number;
  @IsOptional() @IsBoolean() taxExempt?: boolean;
  @IsOptional() @IsString() accNo?: string;
}

/** Freight header fields printed on the tax invoice. All optional free text. */
class InvoiceHeaderDto {
  @IsOptional() @IsString() billToCode?: string;
  @IsOptional() @IsString() attn?: string;
  @IsOptional() @IsString() salesman?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsNumber() exRate?: number;
  @IsOptional() @IsString() pol?: string;
  @IsOptional() @IsString() pod?: string;
  @IsOptional() @IsString() finalDestination?: string;
  @IsOptional() @IsDateString() etd?: string;
  @IsOptional() @IsDateString() eta?: string;
  @IsOptional() @IsString() feederVessel?: string;
  @IsOptional() @IsString() motherVessel?: string;
  @IsOptional() @IsString() hblNo?: string;
  @IsOptional() @IsString() oblNo?: string;
  @IsOptional() @IsString() goods?: string;
  @IsOptional() @IsString() measurement?: string;
  @IsOptional() @IsString() containerInfo?: string;
  @IsOptional() @IsString() noOfPackages?: string;
  @IsOptional() @IsString() shipper?: string;
  @IsOptional() @IsString() consignee?: string;
}

export class CreateInvoiceDto extends InvoiceHeaderDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() currency?: string;
  // Manual-total fallback: used only when no items are supplied (backward compat).
  @IsOptional() @IsNumber() @Min(0) subtotal?: number;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}

export class UpdateInvoiceDto extends InvoiceHeaderDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) subtotal?: number;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}

export class RecordPaymentDto {
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() reference?: string;
}

export class ReversePaymentDto {
  // Mandatory, exactly as on the AP side: cash is never unwound anonymously,
  // and "why" is the part an auditor asks about months later.
  @IsString() @IsNotEmpty({ message: 'A reason is required to reverse a payment' })
  reason: string;
}

export class SendInvoiceEmailDto {
  @IsOptional() @IsEmail() to?: string;
  @IsOptional() @IsString() message?: string;
}

/**
 * Body for POST /invoices/:id/issue. Entirely optional — supplied only when a
 * user with `credit.override` deliberately issues past a credit block (D-7).
 */
export class IssueInvoiceDto {
  @IsOptional() @IsString() @IsNotEmpty({ message: 'A reason is required to override a credit block' })
  creditOverrideReason?: string;
}
