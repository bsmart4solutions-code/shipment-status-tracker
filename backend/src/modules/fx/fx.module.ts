import { Module } from '@nestjs/common';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
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
  constructor(private prisma: PrismaService) {}

  @Get() @RequirePermission('settings.read')
  list() {
    return this.prisma.exchangeRate.findMany({ orderBy: [{ baseCurrency: 'asc' }, { effectiveDate: 'desc' }] });
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
