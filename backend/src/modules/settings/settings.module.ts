import { Body, Controller, Get, Module, Param, Put, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SettingsService } from '../../common/settings.service';
import { AuditService } from '../../common/audit.service';
import { CompanyProfile, DEFAULT_COMPANY_PROFILE } from './company.default';

const COMPANY_KEY = 'company.profile';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings')
class SettingsController {
  constructor(private settings: SettingsService, private audit: AuditService) {}

  // Company profile is readable by ANY authenticated user (no permission
  // gate) because every quotation/invoice print view needs the letterhead —
  // not just admins with settings.read. Declared before the generic routes
  // so "company" is never captured as a :key param.
  @Get('company')
  async company(): Promise<CompanyProfile> {
    const saved = await this.settings.get<Partial<CompanyProfile>>(COMPANY_KEY, {});
    // Merge over defaults so a partially-filled profile still prints cleanly.
    return {
      ...DEFAULT_COMPANY_PROFILE,
      ...saved,
      bank: { ...DEFAULT_COMPANY_PROFILE.bank, ...(saved.bank ?? {}) },
    };
  }

  @Put('company') @RequirePermission('settings.write')
  async setCompany(@Body() body: CompanyProfile, @CurrentUser() user: { id: string }) {
    const saved = await this.settings.set(COMPANY_KEY, body);
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'setting', entityId: COMPANY_KEY });
    return saved;
  }

  @Get() @RequirePermission('settings.read')
  all() { return this.settings.all(); }

  @Put(':key') @RequirePermission('settings.write')
  set(@Param('key') key: string, @Body() body: { value: unknown }) {
    return this.settings.set(key, body.value);
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsApiModule {}
