import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, ValidateNested,
} from 'class-validator';

export class QuotationItemDto {
  @IsUUID() serviceId: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() rateId?: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() quantity: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() costCurrency?: string;
  @IsNumber() unitCost: number;
  @IsOptional() @IsNumber() minimumCharge?: number;
  @IsOptional() @IsNumber() markupPct?: number;
  /** Direct sell price in quotation currency; overrides markupPct when provided. */
  @IsOptional() @IsNumber() unitSell?: number;
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
  @IsArray() @ValidateNested({ each: true }) @Type(() => QuotationItemDto)
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
