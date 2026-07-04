import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesService } from './roles.service';

class SetPermissionsDto {
  @IsArray() @ArrayNotEmpty() permissionIds: string[];
}
class CreateRoleDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get() @RequirePermission('users.read')
  list() { return this.roles.list(); }

  @Get('permissions') @RequirePermission('users.read')
  permissions() { return this.roles.permissions(); }

  @Post() @RequirePermission('users.write')
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: { id: string }) {
    return this.roles.create(dto.name, dto.description, user.id);
  }

  @Put(':id/permissions') @RequirePermission('users.write')
  setPermissions(@Param('id') id: string, @Body() dto: SetPermissionsDto, @CurrentUser() user: { id: string }) {
    return this.roles.setPermissions(id, dto.permissionIds, user.id);
  }
}
