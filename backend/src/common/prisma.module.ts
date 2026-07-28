import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { FileStorageService } from './file-storage.service';
import { FxService } from './fx.service';
import { MailService } from './mail.service';
import { PermissionsService } from './permissions.service';
import { PrismaService } from './prisma.service';
import { SequenceService } from './sequence.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [PrismaService, SequenceService, SettingsService, FxService, AuditService, FileStorageService, MailService, PermissionsService],
  exports: [PrismaService, SequenceService, SettingsService, FxService, AuditService, FileStorageService, MailService, PermissionsService],
})
export class PrismaModule {}
