import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { MailService } from '../../common/mail.service';
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

  constructor(private prisma: PrismaService, private settings: SettingsService, private mail: MailService) {}

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
    const [expiryDays, rateDays, lowMargin, highCost, cutoffHours] = await Promise.all([
      this.settings.get('alerts.quotationExpiryDays', 7),
      this.settings.get('alerts.rateExpiryDays', 14),
      this.settings.get('alerts.lowMarginPct', 10),
      this.settings.get('alerts.highCostAmount', 50000),
      // Hours, not days: SI cut-offs are quoted in hours before departure and
      // a day's granularity is too coarse to act on.
      this.settings.get('alerts.bookingCutoffHours', 48),
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

    // 6. Overdue invoices — in-app alert (deduped weekly) + reminder email
    // (at most once every 7 days, tracked via Invoice.lastReminderAt). Real
    // invoice due dates now exist, so this replaces the old job-completion
    // payment-due proxy.
    const weekPeriod = Math.floor(now.getTime() / (7 * 86400000));
    const overdueInvoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: now } },
      include: { customer: { select: { companyName: true, email: true } } },
    });
    for (const inv of overdueInvoices) {
      await this.push('INVOICE_OVERDUE', 'Invoice overdue',
        `${inv.invoiceNumber} (${inv.customer.companyName}) was due ${inv.dueDate?.toISOString().slice(0, 10)}`,
        'invoice', inv.id, `OVERDUE:${inv.id}:${weekPeriod}`);
      created++;

      const reminderStale = !inv.lastReminderAt || now.getTime() - inv.lastReminderAt.getTime() > 7 * 86400000;
      if (reminderStale && inv.customer.email) {
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const balance = (Number(inv.totalAmount) - Number(inv.amountPaid)).toFixed(2);
        const html = `<p>Dear ${esc(inv.customer.companyName)},</p>
          <p>Invoice <strong>${esc(inv.invoiceNumber)}</strong> was due on ${inv.dueDate?.toISOString().slice(0, 10)} and remains outstanding.</p>
          <p><strong>Balance due: ${esc(inv.currency)} ${balance}</strong></p>
          <p>Please arrange payment at your earliest convenience.</p>`;
        try {
          await this.mail.send(inv.customer.email, `Payment reminder — Invoice ${inv.invoiceNumber}`, html);
          await this.prisma.invoice.update({ where: { id: inv.id }, data: { lastReminderAt: now } });
        } catch (e) {
          this.logger.error(`Overdue reminder email failed for ${inv.invoiceNumber}`, e as Error);
        }
      }
    }

    // 7. Booking cut-offs — SI / VGM / CY.
    //
    // Different in kind from every alert above: an overdue invoice is late but
    // still collectable, whereas a missed SI cut-off means the container does
    // not sail. So this fires BEFORE the deadline, and keeps firing daily
    // while the window is open rather than once per week.
    //
    // The bookings screen already colours a passed cut-off red, but that only
    // helps whoever happens to be looking at it.
    const cutoffWindow = new Date(now.getTime() + cutoffHours * 3600000);
    // Missed cut-offs stay actionable for a few days (re-book, request a
    // late-SI exception), then stop nagging.
    const missedSince = new Date(now.getTime() - 3 * 86400000);
    const dayPeriod = Math.floor(now.getTime() / 86400000);

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: ['DRAFT', 'CONFIRMED'] },
        OR: [
          { siCutoff: { gte: missedSince, lte: cutoffWindow } },
          { vgmCutoff: { gte: missedSince, lte: cutoffWindow } },
          { cyCutoff: { gte: missedSince, lte: cutoffWindow } },
        ],
      },
      include: { customer: { select: { companyName: true } } },
    });

    const CUTOFFS = [
      { key: 'siCutoff', label: 'SI', short: 'SI' },
      { key: 'vgmCutoff', label: 'VGM', short: 'VGM' },
      { key: 'cyCutoff', label: 'CY', short: 'CY' },
    ] as const;

    for (const b of bookings) {
      for (const c of CUTOFFS) {
        const at = b[c.key] as Date | null;
        if (!at || at < missedSince || at > cutoffWindow) continue;

        const hoursAway = Math.round((at.getTime() - now.getTime()) / 3600000);
        const passed = hoursAway < 0;
        const when = at.toISOString().slice(0, 16).replace('T', ' ');
        const title = passed ? `${c.label} cut-off missed` : `${c.label} cut-off approaching`;
        const message = passed
          ? `${b.bookingNumber} (${b.customer.companyName}) — ${c.label} cut-off passed ${when} (${Math.abs(hoursAway)}h ago)`
          : `${b.bookingNumber} (${b.customer.companyName}) — ${c.label} cut-off ${when}, in ${hoursAway}h`;

        // Per booking + cut-off + day: one reminder a day while it matters,
        // not one an hour, and not a single alert that scrolls away unseen.
        await this.push('BOOKING_CUTOFF', title, message, 'booking', b.id,
          `CUTOFF:${b.id}:${c.short}:${dayPeriod}`);
        created++;
      }
    }

    return { scanned: true, alertsCreated: created };
  }
}
