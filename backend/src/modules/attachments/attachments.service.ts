import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttachmentEntity } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { FileStorageService } from '../../common/file-storage.service';
import { PrismaService } from '../../common/prisma.service';

/**
 * Polymorphic attachments (AP_ARCHITECTURE_DECISION §7).
 *
 * Deliberately generic in the storage mechanics and deliberately NOT generic at
 * the API boundary. §7.5 warns: "Never expose /attachments/:id without
 * resolving the owner's permission first." A single global route could not
 * carry a static permission, so callers are per-owner (`customers.*`,
 * `vendors.*`) and every id-addressed operation re-checks that the row really
 * belongs to the entity type the caller claimed. Without that check, holding
 * `customers.read` would be enough to download a vendor's documents by
 * guessing an id.
 */

// Master-data evidence: registrations, tax certificates, credit applications,
// signed agreements. Same whitelist as job documents minus nothing — a scanned
// certificate arrives in exactly these formats.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — same ceiling as job documents

@Injectable()
export class AttachmentsService {
  constructor(
    private prisma: PrismaService,
    private storage: FileStorageService,
    private audit: AuditService,
  ) {}

  /** Confirms the owning row exists and is not in the recycle bin. */
  private async assertOwner(entityType: AttachmentEntity, entityId: string) {
    const found = entityType === 'CUSTOMER'
      ? await this.prisma.customer.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } })
      : await this.prisma.vendor.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundException(`${entityType === 'CUSTOMER' ? 'Customer' : 'Vendor'} not found`);
  }

  /**
   * Load an attachment, refusing it if it belongs to a different entity type.
   * This is the check that stops `customers.read` reaching vendor documents.
   */
  private async loadOwned(entityType: AttachmentEntity, id: string) {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    // Same 404 whether the row is absent or owned by another entity type —
    // a distinct "wrong type" error would confirm the id exists.
    if (!row || row.entityType !== entityType) throw new NotFoundException('Attachment not found');
    return row;
  }

  async upload(
    entityType: AttachmentEntity,
    entityId: string,
    file: Express.Multer.File,
    meta: { category?: string; notes?: string },
    userId?: string,
  ) {
    await this.assertOwner(entityType, entityId);
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    if (file.size > MAX_BYTES) throw new BadRequestException('File exceeds the 15 MB limit');

    // FileStorageService generates the stored name; the user's filename is kept
    // only as display metadata and never reaches the filesystem.
    const storedPath = await this.storage.save(file.buffer, file.originalname);
    const row = await this.prisma.attachment.create({
      data: {
        entityType,
        entityId,
        storedPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        category: meta.category || null,
        notes: meta.notes || null,
        uploadedById: userId ?? null,
      },
      include: { uploadedBy: { select: { fullName: true } } },
    });
    await this.audit.log({
      userId, action: 'UPLOAD', entityType: 'attachment', entityId: row.id,
      detail: { owner: entityType, ownerId: entityId, name: file.originalname, sizeBytes: file.size },
    });
    return row;
  }

  async list(entityType: AttachmentEntity, entityId: string) {
    await this.assertOwner(entityType, entityId);
    return this.prisma.attachment.findMany({
      where: { entityType, entityId },
      include: { uploadedBy: { select: { fullName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getForDownload(entityType: AttachmentEntity, id: string) {
    const row = await this.loadOwned(entityType, id);
    const stream = await this.storage.stream(row.storedPath);
    if (!stream) throw new NotFoundException('File missing from storage');
    return { row, stream };
  }

  async remove(entityType: AttachmentEntity, id: string, userId?: string) {
    const row = await this.loadOwned(entityType, id);
    // Storage first: a failure here leaves the row, which the orphan sweep can
    // still resolve. Deleting the row first would strand the object with
    // nothing left pointing at it.
    await this.storage.remove(row.storedPath);
    await this.prisma.attachment.delete({ where: { id } });
    await this.audit.log({
      userId, action: 'DELETE', entityType: 'attachment', entityId: id,
      detail: { owner: entityType, ownerId: row.entityId, name: row.originalName },
    });
    return { deleted: true };
  }
}
