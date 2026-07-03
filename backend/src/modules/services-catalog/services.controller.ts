import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ServicesService } from './services.service';

class CreateServiceDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateServiceDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('services')
export class ServicesController {
  constructor(private services: ServicesService) {}

  @Get() @RequirePermission('services.read')
  list() { return this.services.list(); }

  @Post() @RequirePermission('services.write')
  create(@Body() dto: CreateServiceDto) { return this.services.create(dto.name, dto.description); }

  @Patch(':id') @RequirePermission('services.write')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) { return this.services.update(id, dto); }

  @Delete(':id') @RequirePermission('services.write')
  remove(@Param('id') id: string) { return this.services.remove(id); }
}
