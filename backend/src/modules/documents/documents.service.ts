import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { FileStorageService } from '../../common/file-storage.service';
import { PrismaService } from '../../common/prisma.service';
import { extractFromText, ExtractionResult } from './bl-extract';

// Whitelist of accepted upload types — freight documents plus rate sheets.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: FileStorageService,
    private audit: AuditService,
  ) {}

  async upload(jobId: string, file: Express.Multer.File, category: string | undefined, userId?: string) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, deletedAt: null }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    if (file.size > MAX_BYTES) throw new BadRequestException('File exceeds the 15 MB limit');

    const storedPath = await this.storage.save(file.buffer, file.originalname);
    const doc = await this.prisma.jobDocument.create({
      data: {
        jobId,
        name: file.originalname,
        category,
        storedPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
    await this.audit.log({ userId, action: 'UPLOAD', entityType: 'document', entityId: doc.id, detail: { jobId, name: file.originalname } });
    return doc;
  }

  async list(jobId: string) {
    return this.prisma.jobDocument.findMany({ where: { jobId }, orderBy: { uploadedAt: 'desc' } });
  }

  async getForDownload(id: string) {
    const doc = await this.prisma.jobDocument.findUnique({ where: { id } });
    if (!doc || !doc.storedPath) throw new NotFoundException('Document not found');
    const stream = this.storage.stream(doc.storedPath);
    if (!stream) throw new NotFoundException('File missing from storage');
    return { doc, stream };
  }

  /** Read the stored PDF's text layer and run template extraction. */
  async extract(id: string, userId?: string): Promise<ExtractionResult & { documentId: string }> {
    const doc = await this.prisma.jobDocument.findUnique({ where: { id } });
    if (!doc || !doc.storedPath) throw new NotFoundException('Document not found');
    if (doc.mimeType !== 'application/pdf') {
      throw new BadRequestException('Extraction is only supported for PDF documents');
    }
    const full = this.storage.resolvePath(doc.storedPath);
    if (!full) throw new NotFoundException('File missing from storage');

    const text = await this.pdfText(full);
    const result = extractFromText(text);
    await this.prisma.jobDocument.update({ where: { id }, data: { extracted: result as unknown as object } });
    await this.audit.log({ userId, action: 'EXTRACT', entityType: 'document', entityId: id, detail: { documentType: result.documentType, confidence: result.confidence } });
    return { documentId: id, ...result };
  }

  private async pdfText(absPath: string): Promise<string> {
    // pdf-parse v2 exposes a PDFParse class; import lazily so the heavy dep
    // only loads when an extraction actually runs.
    const { readFile } = await import('fs/promises');
    const { PDFParse } = await import('pdf-parse');
    const buf = await readFile(absPath);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const res = await parser.getText();
      return res.text || '';
    } finally {
      await parser.destroy();
    }
  }

  async remove(id: string, userId?: string) {
    const doc = await this.prisma.jobDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.storedPath) await this.storage.remove(doc.storedPath);
    await this.prisma.jobDocument.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'document', entityId: id });
    return { deleted: true };
  }
}
