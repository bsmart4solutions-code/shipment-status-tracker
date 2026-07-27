import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import {
  CreateVendorBillDto, ListPayablesDto, RecordVendorPaymentDto,
  ReverseVendorPaymentDto, UpdateVendorBillDto, VoidVendorBillDto,
} from './payables.dto';
import { PayablesService } from './payables.service';

/**
 * Accounts Payable. Guarded by its own `payables.*` scope, deliberately NOT
 * `invoices.*`: a user who can bill customers does not thereby gain the right
 * to create or pay vendor bills.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payables')
export class PayablesController {
  constructor(private payables: PayablesService) {}

  @Get() @RequirePermission('payables.read')
  list(@Query() dto: ListPayablesDto) {
    return this.payables.list(dto);
  }

  // Declared before ':id' so the literal segment is never captured as an id.
  @Get('aging') @RequirePermission('payables.read')
  aging() {
    return this.payables.agingReport();
  }

  @Post('payments/:paymentId/reverse') @RequirePermission('payables.write')
  reversePayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: ReverseVendorPaymentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.payables.reversePayment(paymentId, dto, user.id);
  }

  @Get(':id') @RequirePermission('payables.read')
  get(@Param('id') id: string) { return this.payables.get(id); }

  @Post() @RequirePermission('payables.write')
  create(@Body() dto: CreateVendorBillDto, @CurrentUser() user: { id: string }) {
    return this.payables.create(dto, user.id);
  }

  @Patch(':id') @RequirePermission('payables.write')
  update(@Param('id') id: string, @Body() dto: UpdateVendorBillDto, @CurrentUser() user: { id: string }) {
    return this.payables.update(id, dto, user.id);
  }

  @Post(':id/approve') @RequirePermission('payables.write')
  approve(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.payables.approve(id, user.id);
  }

  @Post(':id/void') @RequirePermission('payables.write')
  void(@Param('id') id: string, @Body() dto: VoidVendorBillDto, @CurrentUser() user: { id: string }) {
    return this.payables.void(id, dto.reason, user.id);
  }

  @Post(':id/payments') @RequirePermission('payables.write')
  recordPayment(@Param('id') id: string, @Body() dto: RecordVendorPaymentDto, @CurrentUser() user: { id: string }) {
    return this.payables.recordPayment(id, dto, user.id);
  }
}
