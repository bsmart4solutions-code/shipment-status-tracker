import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class RateVendorDto {
  @IsUUID() vendorId: string;
  @IsInt() @Min(1) @Max(5) price: number;
  @IsInt() @Min(1) @Max(5) serviceQuality: number;
  @IsInt() @Min(1) @Max(5) communication: number;
  @IsInt() @Min(1) @Max(5) deliveryPerformance: number;
  @IsInt() @Min(1) @Max(5) reliability: number;
  @IsInt() @Min(1) @Max(5) responseSpeed: number;
  @IsOptional() @IsString() comment?: string;
}

export class RateCustomerDto {
  @IsUUID() customerId: string;
  @IsInt() @Min(1) @Max(5) paymentSpeed: number;
  @IsInt() @Min(1) @Max(5) profitability: number;
  @IsInt() @Min(1) @Max(5) repeatBusiness: number;
  @IsInt() @Min(1) @Max(5) communication: number;
  @IsInt() @Min(1) @Max(5) complaintHistory: number;
  @IsInt() @Min(1) @Max(5) businessPotential: number;
  @IsOptional() @IsString() comment?: string;
}
