import { Body, Controller, Module, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  // Server-side workbook parsing (P0-6): the browser uploads the raw .xlsx and
  // receives the extracted preview rows — no spreadsheet parser in the client.
  // memoryStorage + 5 MB cap; the filename is never used as a path.
  @Post('rates/parse') @RequirePermission('rates.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  parseRates(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: { id: string }) {
    return this.imports.parseRateSheet(file, user.id);
  }
}

@Module({ controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
