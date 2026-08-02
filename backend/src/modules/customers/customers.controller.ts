import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { InvoicesService } from '../invoices/invoices.service';
import { CreateCustomerDto, ListCustomersDto, SendStatementDto, UpdateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';
import { CreditService } from './credit.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private customers: CustomersService, private credit: CreditService, private invoices: InvoicesService) {}

  @Get() @RequirePermission('customers.read')
  list(@Query() dto: ListCustomersDto) { return this.customers.list(dto); }

  @Get('ranking') @RequirePermission('customers.read')
  ranking() { return this.customers.ranking(); }

  /**
   * Dry-run: customers whose current exposure already exceeds their effective
   * limit, or who are on hold. Declared before ':id' so it is never captured
   * as an id.
   */
  /** Batch credit standing for the customers currently listed. */
  @Get('credit/summary') @RequirePermission('customers.read')
  creditSummary(@Query('ids') ids?: string) {
    return this.credit.creditSummary((ids ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  }

  @Get('credit/over-limit') @RequirePermission('customers.read')
  overLimit() { return this.credit.overLimitReport(); }

  /** Credit standing for one customer. */
  @Get(':id/credit') @RequirePermission('customers.read')
  creditFor(@Param('id') id: string) { return this.credit.creditFor(id); }

  /** Statement of Account: chronological ledger + running balance. */
  @Get(':id/statement') @RequirePermission('customers.read')
  statement(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.invoices.customerStatement(id, asOf);
  }

  @Post(':id/statement/email') @RequirePermission('invoices.write')
  emailStatement(@Param('id') id: string, @Body() dto: SendStatementDto, @CurrentUser() user: { id: string }) {
    return this.invoices.emailStatement(id, dto.to, dto.message, user.id, dto.asOf);
  }

  @Get(':id') @RequirePermission('customers.read')
  get(@Param('id') id: string) { return this.customers.get(id); }

  @Post() @RequirePermission('customers.write')
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: { id: string }) { return this.customers.create(dto, user.id); }

  @Patch(':id') @RequirePermission('customers.write')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() user: { id: string }) { return this.customers.update(id, dto, user.id); }

  @Delete(':id') @RequirePermission('customers.write')
  remove(@Param('id') id: string) { return this.customers.remove(id); }
}
