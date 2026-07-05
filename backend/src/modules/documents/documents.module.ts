import { Body, Controller, Delete, Get, Module, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { DocumentsService } from './documents.service';
import { OcrService } from './ocr.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
class DocumentsController {
  constructor(private documents: DocumentsService) {}

  @Get('jobs/:jobId/documents') @RequirePermission('jobs.read')
  list(@Param('jobId') jobId: string) {
    return this.documents.list(jobId);
  }

  // File kept in memory (multer memoryStorage) then handed to FileStorageService;
  // we never let multer write with a user-controlled filename.
  @Post('jobs/:jobId/documents/upload') @RequirePermission('jobs.write')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('jobId') jobId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.documents.upload(jobId, file, category, user.id);
  }

  @Post('documents/:id/extract') @RequirePermission('jobs.write')
  extract(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.documents.extract(id, user.id);
  }

  @Get('documents/:id/download') @RequirePermission('jobs.read')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { doc, stream } = await this.documents.getForDownload(id);
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName || doc.name)}"`);
    stream.pipe(res);
  }

  @Delete('documents/:id') @RequirePermission('jobs.write')
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.documents.remove(id, user.id);
  }
}

@Module({ controllers: [DocumentsController], providers: [DocumentsService, OcrService] })
export class DocumentsModule {}
