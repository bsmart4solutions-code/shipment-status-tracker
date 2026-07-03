import { Controller, Get, Module, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PnlFilter, PnlService } from './pnl.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pnl')
class PnlController {
  constructor(private pnl: PnlService) {}

  @Get() @RequirePermission('reports.read')
  report(@Query() filter: PnlFilter) { return this.pnl.report(filter); }
}

@Module({ controllers: [PnlController], providers: [PnlService], exports: [PnlService] })
export class PnlModule {}
