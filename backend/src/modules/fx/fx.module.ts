import { Module } from '@nestjs/common';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { FxService } from '../../common/fx.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../common/prisma.service';

class CreateFxDto {
  @IsString() baseCurrency: string;
  @IsString() quoteCurrency: string;
  @IsNumber() rate: number;
  @IsOptional() @IsDateString() effectiveDate?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fx')
class FxController {
  constructor(private prisma: PrismaService, private fx: FxService) {}

  @Get() @RequirePermission('settings.read')
  list() {
    return this.prisma.exchangeRate.findMany({ orderBy: [{ baseCurrency: 'asc' }, { effectiveDate: 'desc' }] });
  }

  /**
   * The company base currency every conversion resolves to. Exposed so the
   * rate-entry screen can tell the user which side of a pair must be the base
   * — a rate between two foreign currencies can never be used by
   * `FxService.toBase()`. Declared before any ':id' route.
   *
   * Deliberately a separate endpoint rather than folding it into `list()`:
   * that response is an array consumed elsewhere, and reshaping it would be a
   * breaking change for no gain.
   */
  @Get('base-currency') @RequirePermission('settings.read')
  baseCurrency() {
    return { baseCurrency: this.fx.baseCurrency() };
  }

  @Post() @RequirePermission('settings.write')
  create(@Body() dto: CreateFxDto) {
    return this.prisma.exchangeRate.create({
      data: { ...dto, effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date() },
    });
  }

  @Delete(':id') @RequirePermission('settings.write')
  async remove(@Param('id') id: string) {
    await this.prisma.exchangeRate.delete({ where: { id } });
    return { deleted: true };
  }
}

@Module({ controllers: [FxController] })
export class FxModule {}
