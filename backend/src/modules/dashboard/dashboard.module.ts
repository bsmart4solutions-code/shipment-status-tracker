import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('summary') @RequirePermission('dashboard.read')
  summary() { return this.dashboard.summary(); }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
