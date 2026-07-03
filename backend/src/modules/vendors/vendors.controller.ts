import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateVendorDto, UpdateVendorDto } from './vendors.dto';
import { VendorsService } from './vendors.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vendors')
export class VendorsController {
  constructor(private vendors: VendorsService) {}

  @Get() @RequirePermission('vendors.read')
  list(@Query() dto: PaginationDto, @Query('status') status?: string) { return this.vendors.list({ ...dto, status }); }

  @Get('ranking') @RequirePermission('vendors.read')
  ranking() { return this.vendors.ranking(); }

  @Get(':id') @RequirePermission('vendors.read')
  get(@Param('id') id: string) { return this.vendors.get(id); }

  @Post() @RequirePermission('vendors.write')
  create(@Body() dto: CreateVendorDto) { return this.vendors.create(dto); }

  @Patch(':id') @RequirePermission('vendors.write')
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto) { return this.vendors.update(id, dto); }

  @Delete(':id') @RequirePermission('vendors.write')
  remove(@Param('id') id: string) { return this.vendors.remove(id); }
}
