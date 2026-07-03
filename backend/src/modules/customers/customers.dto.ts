import { IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCustomerDto {
  @IsString() companyName: string;
  @IsOptional() @IsString() pic?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() paymentTerm?: string;
  @IsOptional() @IsNumber() creditLimit?: number;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsInt() @Min(1) @Max(5) priority?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateCustomerDto extends CreateCustomerDto {
  @IsOptional() @IsString() declare companyName: string;
}
