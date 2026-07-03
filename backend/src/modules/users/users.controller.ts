import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get() @RequirePermission('users.read')
  list() { return this.users.list(); }

  @Post() @RequirePermission('users.write')
  create(@Body() dto: CreateUserDto) { return this.users.create(dto); }

  @Patch(':id') @RequirePermission('users.write')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) { return this.users.update(id, dto); }
}
