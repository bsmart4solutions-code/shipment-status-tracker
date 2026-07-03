import { Body, Controller, Get, Module, Param, Put, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SettingsService } from '../../common/settings.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings')
class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get() @RequirePermission('settings.read')
  all() { return this.settings.all(); }

  @Put(':key') @RequirePermission('settings.write')
  set(@Param('key') key: string, @Body() body: { value: unknown }) {
    return this.settings.set(key, body.value);
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsApiModule {}
