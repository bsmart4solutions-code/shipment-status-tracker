import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Min,
  ValidateNested,
} from 'class-validator';

const VENDOR_TYPES = [
  'SHIPPING_LINE', 'HAULIER', 'FORWARDING_AGENT', 'CUSTOMS_BROKER', 'WAREHOUSE',
  'COURIER', 'AIRLINE', 'SUPPLIER', 'OTHER',
] as const;

// ── Child rows ──────────────────────────────────────────────────────

export class VendorContactDto {
  @IsString() name: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() remarks?: string;
}

export class VendorAddressDto {
  @IsOptional() @IsIn(['REGISTERED', 'BILLING', 'SHIPPING', 'WAREHOUSE'])
  type?: 'REGISTERED' | 'BILLING' | 'SHIPPING' | 'WAREHOUSE';
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class VendorDocumentDto {
  @IsString() name: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() link?: string;
  @IsOptional() @IsString() notes?: string;
}

export class VendorBankAccountDto {
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() swift?: string;
  @IsOptional() @IsString() bankAddress?: string;
}

// ── Vendor ──────────────────────────────────────────────────────────

export class CreateVendorDto {
  // Company
  @IsString() name: string;
  @IsOptional() @IsIn(VENDOR_TYPES as unknown as string[]) vendorType?: string;
  @IsOptional() @IsString() registrationNo?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() servicesProvided?: string;

  // Primary contact
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() contactTitle?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() officePhone?: string;
  @IsOptional() @IsString() extension?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsString() preferredComm?: string;

  // Legacy single-line address (kept for existing paths)
  @IsOptional() @IsString() address?: string;

  // Financial
  @IsOptional() @IsString() paymentTerm?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsString() taxType?: string;
  @IsOptional() @IsBoolean() taxExempt?: boolean;
  @IsOptional() @IsNumber() openingBalance?: number;
  @IsOptional() @IsDateString() openingBalanceDate?: string;

  // Procurement & operations
  @IsOptional() @IsString() assignedBuyerId?: string;
  @IsOptional() @IsString() preferredMode?: string;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsString() deliveryTerms?: string;
  @IsOptional() @IsNumber() @Min(0) minOrderValue?: number;

  // Accounting
  @IsOptional() @IsString() apAccount?: string;
  @IsOptional() @IsString() vendorAccountCode?: string;
  @IsOptional() @IsString() taxCategory?: string;
  @IsOptional() @IsString() financeRemarks?: string;

  // Compliance & lifecycle
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsBoolean() isPreferred?: boolean;
  @IsOptional() @IsDateString() onboardedDate?: string;
  @IsOptional() @IsDateString() contractStart?: string;
  @IsOptional() @IsDateString() contractEnd?: string;
  @IsOptional() @IsDateString() insuranceExpiry?: string;
  @IsOptional() @IsString() licenseNo?: string;
  @IsOptional() @IsDateString() nextReviewDate?: string;

  // Internal
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() warnings?: string;
  @IsOptional() @IsBoolean() blacklist?: boolean;

  // Nested collections — when provided, they fully replace existing rows.
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VendorContactDto)
  contacts?: VendorContactDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VendorAddressDto)
  addresses?: VendorAddressDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VendorDocumentDto)
  documents?: VendorDocumentDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VendorBankAccountDto)
  bankAccounts?: VendorBankAccountDto[];
}

export class UpdateVendorDto extends CreateVendorDto {
  @IsOptional() @IsString() declare name: string;
}
