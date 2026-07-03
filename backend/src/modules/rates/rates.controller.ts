import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CompareRatesDto, CreateRateDto, UpdateRateDto } from './rates.dto';
import { RatesService } from './rates.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('rates')
export class RatesController {
  constructor(private rates: RatesService) {}

  @Get() @RequirePermission('rates.read')
  list(@Query() dto: PaginationDto, @Query('vendorId') vendorId?: string, @Query('serviceId') serviceId?: string) {
    return this.rates.list({ ...dto, vendorId, serviceId });
  }

  @Get('compare') @RequirePermission('rates.read')
  compare(@Query() dto: CompareRatesDto) { return this.rates.compare(dto); }

  @Post() @RequirePermission('rates.write')
  create(@Body() dto: CreateRateDto) { return this.rates.create(dto); }

  @Patch(':id') @RequirePermission('rates.write')
  update(@Param('id') id: string, @Body() dto: UpdateRateDto) { return this.rates.update(id, dto); }

  @Delete(':id') @RequirePermission('rates.write')
  remove(@Param('id') id: string) { return this.rates.remove(id); }
}
