import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ImportsService } from './imports.service';

class ImportCsvDto {
  @IsString() csv: string;
}

class RateRowDto {
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() containerType?: string;
  @IsNumber() cost: number;
  @IsOptional() @IsNumber() minimumCharge?: number;
  @IsOptional() @IsString() remarks?: string;
}

class ImportRatesDto {
  @IsUUID() vendorId: string;
  @IsUUID() serviceId: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() effectiveDate?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RateRowDto) rows: RateRowDto[];
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('imports')
class ImportsController {
  constructor(private imports: ImportsService) {}

  @Post('customers') @RequirePermission('customers.write')
  customers(@Body() dto: ImportCsvDto, @CurrentUser() user: { id: string }) {
    return this.imports.importCustomers(dto.csv, user.id);
  }

  @Post('vendors') @RequirePermission('vendors.write')
  vendors(@Body() dto: ImportCsvDto, @CurrentUser() user: { id: string }) {
    return this.imports.importVendors(dto.csv, user.id);
  }

  @Post('rates') @RequirePermission('rates.write')
  rates(@Body() dto: ImportRatesDto, @CurrentUser() user: { id: string }) {
    return this.imports.importRates(dto, user.id);
  }
}

@Module({ controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
