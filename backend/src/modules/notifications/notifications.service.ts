import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';

/**
 * Alert generation. `scan()` inspects the database against configurable
 * thresholds and creates deduplicated notifications. Runs automatically
 * every 30 minutes (see scheduledScan) and can also be triggered manually
 * via POST /api/notifications/scan.
 */
@Injectable()
export class NotificationsService {
  private logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  /** The scan engine was fully built but never wired to a scheduler — this activates it. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledScan() {
    try {
      const result = await this.scan();
      if (result.alertsCreated > 0) this.logger.log(`Scheduled scan created ${result.alertsCreated} alert(s)`);
    } catch (e) {
      this.logger.error('Scheduled notification scan failed', e as Error);
    }
  }

  list(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { OR: [{ userId }, { userId: null }], ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(id: string) {
    await this.prisma.notification.update({ where: { id }, data: { isRead: true } });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { OR: [{ userId }, { userId: null }], isRead: false }, data: { isRead: true } });
    return { ok: true };
  }

  private async push(type: NotificationType, title: string, message: string, entityType: string, entityId: string, dedupeKey: string) {
    // dedupeKey ensures one alert per entity+type+period
    await this.prisma.notification
      .create({ data: { type, title, message, entityType, entityId, dedupeKey } })
      .catch(() => undefined); // unique violation -> already alerted
  }

  async scan() {
    const now = new Date();
    const period = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const [expiryDays, rateDays, lowMargin, highCost] = await Promise.all([
      this.settings.get('alerts.quotationExpiryDays', 7),
      this.settings.get('alerts.rateExpiryDays', 14),
      this.settings.get('alerts.lowMarginPct', 10),
      this.settings.get('alerts.highCostAmount', 50000),
    ]);
    const soon = (days: number) => new Date(now.getTime() + days * 86400000);
    let created = 0;

    // 1. Quotation expiry
    const expiring = await this.prisma.quotation.findMany({
      where: { status: { in: ['DRAFT', 'SENT'] }, validityDate: { gte: now, lte: soon(expiryDays) } },
    });
    for (const q of expiring) {
      await this.push('QUOTATION_EXPIRY', 'Quotation expiring',
        `${q.quoteNumber} expires on ${q.validityDate?.toISOString().slice(0, 10)}`,
        'quotation', q.id, `QEXP:${q.id}:${period}`);
      created++;
    }

    // 2. Vendor rate expiry
    const expiringRates = await this.prisma.vendorServiceRate.findMany({
      where: { expiryDate: { gte: now, lte: soon(rateDays) } },
      include: { vendor: { select: { name: true } }, service: { select: { name: true } } },
    });
    for (const r of expiringRates) {
      await this.push('VENDOR_RATE_EXPIRY', 'Vendor rate expiring',
        `${r.vendor.name} — ${r.service.name} (${r.origin ?? ''}→${r.destination ?? ''}) expires ${r.expiryDate?.toISOString().slice(0, 10)}`,
        'rate', r.id, `REXP:${r.id}`);
      created++;
    }

    // 3. Job delays: past ETA and not completed
    const delayed = await this.prisma.job.findMany({
      where: { eta: { lt: now }, status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] } },
    });
    for (const j of delayed) {
      await this.push('JOB_DELAY', 'Job past ETA',
        `${j.jobNumber} was due ${j.eta?.toISOString().slice(0, 10)} and is still ${j.status}`,
        'job', j.id, `JDEL:${j.id}:${period}`);
      created++;
    }

    // 4. Low margin quotes (active pipeline only)
    const lowMarginQuotes = await this.prisma.quotation.findMany({
      where: { status: { in: ['DRAFT', 'SENT'] }, gpPercent: { lt: lowMargin }, sellingPrice: { gt: 0 } },
    });
    for (const q of lowMarginQuotes) {
      await this.push('LOW_MARGIN', 'Low margin alert',
        `${q.quoteNumber} GP is ${Number(q.gpPercent).toFixed(1)}% (threshold ${lowMargin}%)`,
        'quotation', q.id, `LOWM:${q.id}`);
      created++;
    }

    // 5. High cost alert
    const highCostQuotes = await this.prisma.quotation.findMany({
      where: { status: { in: ['DRAFT', 'SENT'] }, totalCost: { gt: highCost } },
    });
    for (const q of highCostQuotes) {
      await this.push('HIGH_COST', 'High cost alert',
        `${q.quoteNumber} vendor cost ${Number(q.totalCost).toLocaleString()} exceeds ${highCost.toLocaleString()}`,
        'quotation', q.id, `HIGHC:${q.id}`);
      created++;
    }

    // 6. Customer payment due — jobs completed, payment term elapsed (proxy until invoicing module lands)
    const completed = await this.prisma.job.findMany({
      where: { status: 'COMPLETED' },
      include: { customer: { select: { companyName: true, paymentTerm: true } } },
    });
    for (const j of completed) {
      const term = parseInt((j.customer.paymentTerm ?? '').replace(/\D/g, ''), 10);
      if (!term) continue;
      const due = new Date(j.updatedAt.getTime() + term * 86400000);
      if (due < now) {
        await this.push('PAYMENT_DUE', 'Customer payment due',
          `${j.customer.companyName} — ${j.jobNumber} payment was due ${due.toISOString().slice(0, 10)}`,
          'job', j.id, `PDUE:${j.id}`);
        created++;
      }
    }

    return { scanned: true, alertsCreated: created };
  }
}
