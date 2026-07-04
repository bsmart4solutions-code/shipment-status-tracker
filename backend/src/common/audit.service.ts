import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { requestContext } from './request-context';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Prisma.InputJsonValue;
}

/**
 * Central audit writer. Automatically stamps each entry with the caller's
 * IP and User-Agent from the request context, so call sites stay one-liners.
 * Audit failures are logged but never break the business operation.
 */
@Injectable()
export class AuditService {
  private logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    const ctx = requestContext.getStore();
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? undefined,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? undefined,
          detail: entry.detail,
          ip: ctx?.ip,
          userAgent: ctx?.userAgent,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to write audit log (${entry.action} ${entry.entityType})`, e as Error);
    }
  }
}
