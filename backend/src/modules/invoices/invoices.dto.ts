import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEmail, IsNumber, IsOptional, IsPositive, IsString, IsUUID,
  Min, ValidateNested,
} from 'class-validator';

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

export class SendInvoiceEmailDto {
  @IsOptional() @IsEmail() to?: string;
  @IsOptional() @IsString() message?: string;
}
