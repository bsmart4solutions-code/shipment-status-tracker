import { Module } from '@nestjs/common';
import { CreditDebitNotesController } from './credit-debit-notes.controller';
import { CreditDebitNotesService } from './credit-debit-notes.service';

@Module({
  controllers: [CreditDebitNotesController],
  providers: [CreditDebitNotesService],
})
export class CreditDebitNotesModule {}
