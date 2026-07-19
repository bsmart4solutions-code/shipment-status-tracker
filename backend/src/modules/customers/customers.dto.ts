import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max,
  Min, ValidateNested,
} from 'class-validator';

// ── Child rows ──────────────────────────────────────────────────────

export class CustomerContactDto {
  @IsString() name: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() remarks?: string;
}

export class CustomerAddressDto {
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

export class CustomerDocumentDto {
  @IsString() name: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() link?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CustomerBankAccountDto {
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() swift?: string;
  @IsOptional() @IsString() bankAddress?: string;
}

// ── Customer ────────────────────────────────────────────────────────

export class CreateCustomerDto {
  // Company
  @IsString() companyName: string;
  @IsOptional() @IsIn(['COMPANY', 'INDIVIDUAL']) customerType?: 'COMPANY' | 'INDIVIDUAL';
  @IsOptional() @IsString() registrationNo?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() customerCategory?: string;
  @IsOptional() @IsString() salesTerritory?: string;
  @IsOptional() @IsString() leadSource?: string;

  // Primary contact
  @IsOptional() @IsString() pic?: string;
  @IsOptional() @IsString() contactTitle?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() officePhone?: string;
  @IsOptional() @IsString() extension?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsString() preferredComm?: string;

  // Legacy single-line address (kept for existing print/email paths)
  @IsOptional() @IsString() address?: string;

  // Financial
  @IsOptional() @IsString() paymentTerm?: string;
  @IsOptional() @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsNumber() @Min(0) outstandingLimit?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() priceLevel?: string;
  @IsOptional() @IsString() taxType?: string;
  @IsOptional() @IsBoolean() taxExempt?: boolean;
  @IsOptional() @IsBoolean() creditHold?: boolean;
  @IsOptional() @IsNumber() openingBalance?: number;
  @IsOptional() @IsDateString() openingBalanceDate?: string;

  // Sales & operations
  @IsOptional() @IsString() assignedSalespersonId?: string;
  @IsOptional() @IsString() salesTeam?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) priority?: number;
  @IsOptional() @IsString() discountGroup?: string;
  @IsOptional() @IsNumber() @Min(0) defaultDiscountPct?: number;
  @IsOptional() @IsString() commissionGroup?: string;
  @IsOptional() @IsString() defaultWarehouse?: string;
  @IsOptional() @IsString() preferredDeliveryMethod?: string;
  @IsOptional() @IsString() preferredShippingCompany?: string;

  // Accounting
  @IsOptional() @IsString() arAccount?: string;
  @IsOptional() @IsString() customerAccountCode?: string;
  @IsOptional() @IsString() taxCategory?: string;
  @IsOptional() @IsString() financeRemarks?: string;

  // Shipping
  @IsOptional() @IsString() deliveryInstructions?: string;
  @IsOptional() @IsString() receivingHours?: string;
  @IsOptional() @IsString() loadingBayNotes?: string;
  @IsOptional() @IsString() preferredCourier?: string;
  @IsOptional() @IsString() shippingNotes?: string;

  // CRM
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsString() leadStatus?: string;
  @IsOptional() @IsDateString() firstContactDate?: string;
  @IsOptional() @IsDateString() customerSince?: string;
  @IsOptional() @IsDateString() lastContactDate?: string;
  @IsOptional() @IsDateString() lastSalesDate?: string;
  @IsOptional() @IsDateString() nextFollowUp?: string;
  @IsOptional() @IsDateString() birthday?: string;
  @IsOptional() @IsDateString() companyAnniversary?: string;

  // Preferences
  @IsOptional() @IsString() preferredLanguage?: string;
  @IsOptional() @IsString() timeZone?: string;
  @IsOptional() @IsBoolean() receivePromotions?: boolean;
  @IsOptional() @IsBoolean() receiveStatementsByEmail?: boolean;
  @IsOptional() @IsBoolean() receiveInvoiceByEmail?: boolean;

  // Internal
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() creditNotesInternal?: string;
  @IsOptional() @IsString() collectionNotes?: string;
  @IsOptional() @IsString() customerWarnings?: string;
  @IsOptional() @IsBoolean() blacklist?: boolean;
  @IsOptional() @IsBoolean() vip?: boolean;

  // Nested collections — when provided, they fully replace the existing rows.
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomerContactDto)
  contacts?: CustomerContactDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomerAddressDto)
  addresses?: CustomerAddressDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomerDocumentDto)
  documents?: CustomerDocumentDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomerBankAccountDto)
  bankAccounts?: CustomerBankAccountDto[];
}

export class UpdateCustomerDto extends CreateCustomerDto {
  @IsOptional() @IsString() declare companyName: string;
}
