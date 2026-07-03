import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SequenceService } from './sequence.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, SequenceService, SettingsService],
  exports: [PrismaService, SequenceService, SettingsService],
})
export class PrismaModule {}
