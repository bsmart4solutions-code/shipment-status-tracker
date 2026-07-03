import { IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateVendorDto {
  @IsString() name: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() paymentTerm?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsBoolean() isPreferred?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateVendorDto extends CreateVendorDto {
  @IsOptional() @IsString() declare name: string;
}
