import { Module } from '@nestjs/common';
import { PayablesModule } from '../payables/payables.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

// PayablesModule is imported for the READ-ONLY job cost variance query. AP
// never writes job values (AP_ARCHITECTURE_DECISION.md §4).
@Module({ imports: [PayablesModule], controllers: [JobsController], providers: [JobsService] })
export class JobsModule {}
