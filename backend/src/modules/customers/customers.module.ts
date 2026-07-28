import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { CreditService } from './credit.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

// InvoicesModule is imported for READ-ONLY customer exposure: AR owns the
// balance formula and credit control consumes it rather than re-deriving it.
@Module({
  imports: [InvoicesModule],
  controllers: [CustomersController],
  providers: [CustomersService, CreditService],
  exports: [CustomersService, CreditService],
})
export class CustomersModule {}
