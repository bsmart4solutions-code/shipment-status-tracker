import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsPositive,
  IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';

export class QuotationItemDto {
  @IsUUID() serviceId: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() rateId?: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() costCurrency?: string;
  @IsNumber() @Min(0) unitCost: number;
  @IsOptional() @IsNumber() @Min(0) minimumCharge?: number;
  @IsOptional() @IsNumber() @Min(0) markupPct?: number;
  /** Direct sell price in quotation currency; overrides markupPct when provided. */
  @IsOptional() @IsNumber() @Min(0) unitSell?: number;
  /** SST-exempt line (printed as SVE 0%), e.g. ocean freight. */
  @IsOptional() @IsBoolean() taxExempt?: boolean;
}

export class CreateQuotationDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsDateString() quoteDate?: string;
  @IsOptional() @IsDateString() validityDate?: string;
  @IsOptional() @IsUUID() salesPersonId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() discountPct?: number;
  @IsOptional() @IsNumber() discountAmt?: number;
  @IsOptional() @IsNumber() serviceChargePct?: number;
  @IsOptional() @IsNumber() miscCharge?: number;
  @IsOptional() @IsNumber() taxPct?: number;
  @IsOptional() @IsString() remark?: string;
  // Freight header printed on the quotation (all optional free text)
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() yourRef?: string;
  @IsOptional() @IsString() attn?: string;
  @IsOptional() @IsString() pol?: string;
  @IsOptional() @IsString() pod?: string;
  @IsOptional() @IsString() finalDestination?: string;
  @IsOptional() @IsString() modeOfTransport?: string;
  @IsOptional() @IsString() shipmentType?: string;
  @IsOptional() @IsString() carrier?: string;
  @IsOptional() @IsString() transitTime?: string;
  @IsOptional() @IsString() freeTime?: string;
  @IsOptional() @IsString() goods?: string;
  @IsOptional() @IsString() cargoWeight?: string;
  @IsOptional() @IsString() cargoVolume?: string;
  @IsOptional() @IsString() shippingTerm?: string;
  @IsOptional() @IsString() paymentTerm?: string;
  @IsOptional() @IsString() exclusions?: string;
  // A quotation with zero priced items is not a real quote — the "New
  // Quotation" form used to let you submit one with the default blank row
  // untouched (no service picked), silently creating an empty MYR 0.00 quote.
  @IsArray() @ArrayMinSize(1, { message: 'Add at least one cost item before saving the quotation' })
  @ValidateNested({ each: true }) @Type(() => QuotationItemDto)
  items: QuotationItemDto[];
}

export class UpdateQuotationDto extends CreateQuotationDto {
  @IsOptional() @IsUUID() declare customerId: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuotationItemDto)
  declare items: QuotationItemDto[];
}

export class SetStatusDto {
  @IsIn(['DRAFT', 'SENT', 'WON', 'LOST', 'CANCELLED'])
  status: 'DRAFT' | 'SENT' | 'WON' | 'LOST' | 'CANCELLED';
}

export class SendEmailDto {
  @IsOptional() @IsEmail() to?: string;
  @IsOptional() @IsString() message?: string;
}

export class ApprovalDecisionDto {
  @IsOptional() @IsString() note?: string;
}
