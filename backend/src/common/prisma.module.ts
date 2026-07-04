import { Global, Module } from '@nestjs/common';
import { FxService } from './fx.service';
import { PrismaService } from './prisma.service';
import { SequenceService } from './sequence.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, SequenceService, SettingsService, FxService],
  exports: [PrismaService, SequenceService, SettingsService, FxService],
})
export class PrismaModule {}
