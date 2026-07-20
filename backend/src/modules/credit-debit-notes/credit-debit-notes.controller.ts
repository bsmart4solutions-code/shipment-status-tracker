import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateNoteDto, ListNotesDto, UpdateNoteDto } from './credit-debit-notes.dto';
import { CreditDebitNotesService } from './credit-debit-notes.service';

// Credit/Debit notes are billing documents — governed by the invoice
// permission scope (a user who can bill can adjust).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('credit-debit-notes')
export class CreditDebitNotesController {
  constructor(private notes: CreditDebitNotesService) {}

  @Get() @RequirePermission('invoices.read')
  list(@Query() dto: ListNotesDto) {
    return this.notes.list(dto);
  }

  @Get('from-invoice/:invoiceId') @RequirePermission('invoices.write')
  fromInvoice(@Param('invoiceId') invoiceId: string, @Query('type') type?: string) {
    return this.notes.fromInvoice(invoiceId, type === 'DEBIT' ? 'DEBIT' : 'CREDIT');
  }

  @Get(':id') @RequirePermission('invoices.read')
  get(@Param('id') id: string) { return this.notes.get(id); }

  @Post() @RequirePermission('invoices.write')
  create(@Body() dto: CreateNoteDto, @CurrentUser() user: { id: string }) { return this.notes.create(dto, user.id); }

  @Patch(':id') @RequirePermission('invoices.write')
  update(@Param('id') id: string, @Body() dto: UpdateNoteDto, @CurrentUser() user: { id: string }) { return this.notes.update(id, dto, user.id); }

  @Post(':id/issue') @RequirePermission('invoices.write')
  issue(@Param('id') id: string, @CurrentUser() user: { id: string }) { return this.notes.issue(id, user.id); }

  @Post(':id/cancel') @RequirePermission('invoices.write')
  cancel(@Param('id') id: string, @CurrentUser() user: { id: string }) { return this.notes.cancel(id, user.id); }
}
