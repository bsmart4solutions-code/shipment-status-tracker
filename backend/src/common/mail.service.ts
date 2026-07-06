import { Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';

export interface MailResult {
  sent: boolean;
  /** true when SMTP isn't configured and the message was only logged. */
  simulated: boolean;
  messageId?: string;
}

/**
 * Outbound email. Configured entirely by env:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * When SMTP_HOST is absent the service falls back to nodemailer's
 * jsonTransport: the message is composed and logged but not sent, and the
 * result carries simulated=true so callers/UI can say so honestly. This keeps
 * the feature fully testable locally and safe on deployments that haven't
 * configured a mail server yet.
 */
@Injectable()
export class MailService {
  private logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private simulated = false;

  private async getTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    const nodemailer = await import('nodemailer');
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.simulated = true;
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn('SMTP_HOST not set — emails will be simulated (logged, not sent)');
    } else {
      const port = Number(process.env.SMTP_PORT || 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
    }
    return this.transporter;
  }

  async send(to: string, subject: string, html: string): Promise<MailResult> {
    const transporter = await this.getTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'erp@localhost';
    const info = await transporter.sendMail({ from, to, subject, html });
    if (this.simulated) {
      this.logger.log(`[simulated email] to=${to} subject="${subject}"`);
      return { sent: false, simulated: true, messageId: info.messageId };
    }
    return { sent: true, simulated: false, messageId: info.messageId };
  }
}
