import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get() @RequirePermission('customers.read')
  list(@Query() dto: PaginationDto, @Query('status') status?: string) { return this.customers.list({ ...dto, status }); }

  @Get('ranking') @RequirePermission('customers.read')
  ranking() { return this.customers.ranking(); }

  @Get(':id') @RequirePermission('customers.read')
  get(@Param('id') id: string) { return this.customers.get(id); }

  @Post() @RequirePermission('customers.write')
  create(@Body() dto: CreateCustomerDto) { return this.customers.create(dto); }

  @Patch(':id') @RequirePermission('customers.write')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) { return this.customers.update(id, dto); }

  @Delete(':id') @RequirePermission('customers.write')
  remove(@Param('id') id: string) { return this.customers.remove(id); }
}
