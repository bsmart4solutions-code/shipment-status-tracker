import {
  Body, Controller, Delete, Get, Module, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AttachmentsService } from './attachments.service';

/**
 * Two controllers over one service, rather than one generic `/attachments`
 * controller — the permission has to be static per route, and a customer
 * document and a vendor document are not guarded by the same one
 * (AP_ARCHITECTURE_DECISION §7.5).
 *
 * The service re-checks ownership on every id-addressed call, so these routes
 * cannot be used to reach each other's rows.
 */

function sendDownload(res: Response, row: { mimeType: string; originalName: string }, stream: NodeJS.ReadableStream) {
  res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.originalName)}"`);
  stream.pipe(res);
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
class CustomerAttachmentsController {
  constructor(private attachments: AttachmentsService) {}

  @Get(':customerId/attachments') @RequirePermission('customers.read')
  list(@Param('customerId') customerId: string) {
    return this.attachments.list('CUSTOMER', customerId);
  }

  @Post(':customerId/attachments') @RequirePermission('customers.write')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('customerId') customerId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string | undefined,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.attachments.upload('CUSTOMER', customerId, file, { category, notes }, user.id);
  }

  // Declared after the parameterised routes above but distinct enough not to
  // collide: 'attachments' is a literal first segment here.
  @Get('attachments/:id/download') @RequirePermission('customers.read')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { row, stream } = await this.attachments.getForDownload('CUSTOMER', id);
    sendDownload(res, row, stream);
  }

  @Delete('attachments/:id') @RequirePermission('customers.write')
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.attachments.remove('CUSTOMER', id, user.id);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vendors')
class VendorAttachmentsController {
  constructor(private attachments: AttachmentsService) {}

  @Get(':vendorId/attachments') @RequirePermission('vendors.read')
  list(@Param('vendorId') vendorId: string) {
    return this.attachments.list('VENDOR', vendorId);
  }

  @Post(':vendorId/attachments') @RequirePermission('vendors.write')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('vendorId') vendorId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string | undefined,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.attachments.upload('VENDOR', vendorId, file, { category, notes }, user.id);
  }

  @Get('attachments/:id/download') @RequirePermission('vendors.read')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { row, stream } = await this.attachments.getForDownload('VENDOR', id);
    sendDownload(res, row, stream);
  }

  @Delete('attachments/:id') @RequirePermission('vendors.write')
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.attachments.remove('VENDOR', id, user.id);
  }
}

@Module({
  controllers: [CustomerAttachmentsController, VendorAttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
