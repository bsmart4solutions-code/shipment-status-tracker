import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { FxService } from './fx.service';
import { PrismaService } from './prisma.service';
import { SequenceService } from './sequence.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, SequenceService, SettingsService, FxService, AuditService],
  exports: [PrismaService, SequenceService, SettingsService, FxService, AuditService],
})
export class PrismaModule {}
