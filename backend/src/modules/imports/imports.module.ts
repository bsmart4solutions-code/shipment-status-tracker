import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ImportsService } from './imports.service';

class ImportCsvDto {
  @IsString() csv: string;
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
}

@Module({ controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
