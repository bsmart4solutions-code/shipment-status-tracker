import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateInvoiceDto, RecordPaymentDto, SendInvoiceEmailDto, UpdateInvoiceDto } from './invoices.dto';
import { InvoicesService } from './invoices.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @Get() @RequirePermission('invoices.read')
  list(
    @Query() dto: PaginationDto,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('jobId') jobId?: string,
  ) {
    return this.invoices.list({ ...dto, status, customerId, jobId });
  }

  @Get('aging') @RequirePermission('invoices.read')
  aging() { return this.invoices.agingReport(); }

  @Get(':id') @RequirePermission('invoices.read')
  get(@Param('id') id: string) { return this.invoices.get(id); }

  @Post() @RequirePermission('invoices.write')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: { id: string }) {
    return this.invoices.create(dto, user.id);
  }

  @Post('from-job/:jobId') @RequirePermission('invoices.write')
  generateFromJob(@Param('jobId') jobId: string, @CurrentUser() user: { id: string }) {
    return this.invoices.generateFromJob(jobId, user.id);
  }

  @Patch(':id') @RequirePermission('invoices.write')
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @CurrentUser() user: { id: string }) {
    return this.invoices.update(id, dto, user.id);
  }

  @Post(':id/issue') @RequirePermission('invoices.write')
  issue(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.invoices.issue(id, user.id);
  }

  @Post(':id/cancel') @RequirePermission('invoices.write')
  cancel(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.invoices.cancel(id, user.id);
  }

  @Post(':id/payments') @RequirePermission('invoices.write')
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: { id: string }) {
    return this.invoices.recordPayment(id, dto, user.id);
  }

  @Post(':id/email') @RequirePermission('invoices.write')
  email(@Param('id') id: string, @Body() dto: SendInvoiceEmailDto, @CurrentUser() user: { id: string }) {
    return this.invoices.email(id, dto.to, dto.message, user.id);
  }
}
