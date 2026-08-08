import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequestUser } from '../../common/permissions.service';
import {
  CreateInvoiceDto, IssueInvoiceDto, ListInvoicesDto, RecordPaymentDto, ReversePaymentDto,
  SendInvoiceEmailDto, UpdateInvoiceDto,
} from './invoices.dto';
import { InvoicesService } from './invoices.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @Get() @RequirePermission('invoices.read')
  list(@Query() dto: ListInvoicesDto) {
    return this.invoices.list(dto);
  }

  @Get('aging') @RequirePermission('invoices.read')
  aging() { return this.invoices.agingReport(); }

  /**
   * Declared before `:id` on purpose — Nest matches routes in declaration
   * order, so a later `payments/...` path would be swallowed by `:id`.
   * Keyed by payment, not invoice: the payment id alone identifies it, and
   * requiring the invoice id too would let a caller pass a mismatched pair.
   */
  @Post('payments/:paymentId/reverse') @RequirePermission('invoices.write')
  reversePayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: ReversePaymentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.invoices.reversePayment(paymentId, dto, user.id);
  }

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
  issue(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    // Optional: present only when deliberately overriding a credit block.
    // Existing callers that send no body are unaffected.
    @Body() dto: IssueInvoiceDto = {},
  ) {
    return this.invoices.issue(id, user.id, { creditOverrideReason: dto?.creditOverrideReason, user });
  }

  /** Credit standing for an invoice about to be issued (read-only). */
  @Get(':id/credit-check') @RequirePermission('invoices.read')
  creditCheck(@Param('id') id: string) {
    return this.invoices.creditCheckForInvoice(id);
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
