import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { FileStorageService } from '../../common/file-storage.service';
import { PrismaService } from '../../common/prisma.service';
import { rethrowPrisma } from '../../common/prisma-errors';

/**
 * Registry of soft-deletable entities. Each entry maps a URL-facing key to its
 * Prisma model delegate name and a label field for display in the bin. Adding
 * an entity to soft delete = add one row here.
 */
export const RECYCLABLE = {
  customer: { model: 'customer', label: 'companyName', title: 'Customer' },
  vendor: { model: 'vendor', label: 'name', title: 'Vendor' },
  service: { model: 'service', label: 'name', title: 'Service' },
  quotation: { model: 'quotation', label: 'quoteNumber', title: 'Quotation' },
  job: { model: 'job', label: 'jobNumber', title: 'Job' },
} as const;

export type RecyclableKey = keyof typeof RECYCLABLE;

@Injectable()
export class RecycleBinService {
  constructor(private prisma: PrismaService, private audit: AuditService, private storage: FileStorageService) {}

  private resolve(entity: string) {
    const cfg = (RECYCLABLE as Record<string, (typeof RECYCLABLE)[RecyclableKey]>)[entity];
    if (!cfg) throw new BadRequestException(`Unknown recyclable entity: ${entity}`);
    return cfg;
  }

  private delegate(model: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any)[model];
  }

  /** List soft-deleted rows across all recyclable entities (or one). */
  async list(entity?: string) {
    const keys = entity ? [entity as RecyclableKey] : (Object.keys(RECYCLABLE) as RecyclableKey[]);
    const groups = await Promise.all(
      keys.map(async (key) => {
        const cfg = this.resolve(key);
        const rows = await this.delegate(cfg.model).findMany({
          where: { deletedAt: { not: null } },
          orderBy: { deletedAt: 'desc' },
          take: 100,
        });
        return {
          entity: key,
          title: cfg.title,
          items: rows.map((r: Record<string, unknown>) => ({
            id: r.id,
            label: r[cfg.label] ?? '(unnamed)',
            deletedAt: r.deletedAt,
          })),
        };
      }),
    );
    return groups;
  }

  async restore(entity: string, id: string, userId?: string) {
    const cfg = this.resolve(entity);
    const existing = await this.delegate(cfg.model).findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundException(`${cfg.title} not found in recycle bin`);
    await this.delegate(cfg.model).update({ where: { id }, data: { deletedAt: null } });
    await this.audit.log({ userId, action: 'RESTORE', entityType: entity, entityId: id });
    return { restored: true };
  }

  /** Permanent hard delete. May legitimately fail (409) if FK dependents exist. */
  async purge(entity: string, id: string, userId?: string) {
    const cfg = this.resolve(entity);
    const existing = await this.delegate(cfg.model).findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundException(`${cfg.title} not found in recycle bin`);

    // Purging a job cascade-deletes its JobDocument rows at the DB level,
    // which would orphan the stored binaries — remove those files first.
    if (entity === 'job') {
      const docs = await this.prisma.jobDocument.findMany({ where: { jobId: id }, select: { storedPath: true } });
      for (const d of docs) {
        if (d.storedPath) await this.storage.remove(d.storedPath);
      }
    }

    try {
      await this.delegate(cfg.model).delete({ where: { id } });
    } catch (e) {
      rethrowPrisma(e, cfg.title, `${cfg.title} still has related records and cannot be permanently deleted`);
    }
    await this.audit.log({ userId, action: 'PURGE', entityType: entity, entityId: id });
    return { purged: true };
  }
}
