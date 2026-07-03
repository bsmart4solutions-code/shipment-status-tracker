import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateQuotationDto, SetStatusDto, UpdateQuotationDto } from './quotations.dto';
import { QuotationsService } from './quotations.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private quotations: QuotationsService) {}

  @Get() @RequirePermission('quotations.read')
  list(
    @Query() dto: PaginationDto,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('salesPersonId') salesPersonId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.quotations.list({ ...dto, status, customerId, salesPersonId, from, to });
  }

  @Get(':id') @RequirePermission('quotations.read')
  get(@Param('id') id: string) { return this.quotations.get(id); }

  @Post() @RequirePermission('quotations.write')
  create(@Body() dto: CreateQuotationDto, @CurrentUser() user: { id: string }) {
    return this.quotations.create(dto, user.id);
  }

  @Put(':id') @RequirePermission('quotations.write')
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @CurrentUser() user: { id: string }) {
    return this.quotations.update(id, dto, user.id);
  }

  @Patch(':id/status') @RequirePermission('quotations.write')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() user: { id: string }) {
    return this.quotations.setStatus(id, dto.status, user.id);
  }

  @Post(':id/convert') @RequirePermission('quotations.write')
  convert(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quotations.convertToJob(id, user.id);
  }

  @Delete(':id') @RequirePermission('quotations.write')
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quotations.remove(id, user.id);
  }
}
