import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

const RATE_TYPES = ['FIXED', 'PER_KG', 'PER_CBM', 'PER_TON', 'PER_TRIP', 'PER_CONTAINER', 'PER_SHIPMENT', 'PER_HOUR', 'PER_DAY'] as const;

export class CreateRateDto {
  @IsUUID() vendorId: string;
  @IsUUID() serviceId: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() containerType?: string;
  @IsIn(RATE_TYPES as unknown as string[]) rateType: (typeof RATE_TYPES)[number];
  @IsString() currency: string;
  @IsNumber() cost: number;
  @IsOptional() @IsNumber() minimumCharge?: number;
  @IsOptional() @IsDateString() effectiveDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() remarks?: string;
}

export class UpdateRateDto extends CreateRateDto {
  @IsOptional() @IsUUID() declare vendorId: string;
  @IsOptional() @IsUUID() declare serviceId: string;
  @IsOptional() @IsIn(RATE_TYPES as unknown as string[]) declare rateType: (typeof RATE_TYPES)[number];
  @IsOptional() @IsString() declare currency: string;
  @IsOptional() @IsNumber() declare cost: number;
}

export class CompareRatesDto {
  @IsUUID() serviceId: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsDateString() date?: string; // as-of date; enables historical comparison
  @IsOptional() @IsIn(['cost', 'rating', 'preferred']) sort?: 'cost' | 'rating' | 'preferred';
  @IsOptional() includeExpired?: string; // 'true' -> historical view
}
