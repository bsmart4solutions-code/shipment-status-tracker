import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { parseCsv } from '../../common/csv-parse.util';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';

export interface ImportRowResult {
  row: number;
  status: 'created' | 'skipped';
  reason?: string;
  label?: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  skipped: number;
  results: ImportRowResult[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * CSV bulk import for master data. Rows are validated one by one; a bad row is
 * skipped with a reason rather than failing the whole file, and the caller
 * gets a per-row report. Duplicate detection is by a natural key (company/name
 * or email) so re-uploading the same sheet doesn't create duplicates.
 */
@Injectable()
export class ImportsService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private audit: AuditService) {}

  async importCustomers(csv: string, userId?: string): Promise<ImportSummary> {
    const rows = this.parse(csv);
    const results: ImportRowResult[] = [];
    let created = 0;

    // Pre-load existing keys once for dedupe.
    const existing = await this.prisma.customer.findMany({ where: { deletedAt: null }, select: { companyName: true, email: true } });
    const names = new Set(existing.map((c) => c.companyName.toLowerCase()));
    const emails = new Set(existing.filter((c) => c.email).map((c) => c.email!.toLowerCase()));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // +1 header, +1 to 1-index
      const companyName = pick(r, ['companyname', 'company name', 'company', 'name']);
      const email = pick(r, ['email', 'e-mail']);
      if (!companyName) { results.push({ row: rowNum, status: 'skipped', reason: 'missing companyName' }); continue; }
      if (email && !EMAIL_RE.test(email)) { results.push({ row: rowNum, status: 'skipped', reason: `invalid email "${email}"`, label: companyName }); continue; }
      if (names.has(companyName.toLowerCase())) { results.push({ row: rowNum, status: 'skipped', reason: 'duplicate company name', label: companyName }); continue; }
      if (email && emails.has(email.toLowerCase())) { results.push({ row: rowNum, status: 'skipped', reason: 'duplicate email', label: companyName }); continue; }

      const code = await this.seq.next('customer');
      await this.prisma.customer.create({
        data: {
          code, companyName,
          pic: pick(r, ['pic', 'contact', 'person in charge']) || undefined,
          phone: pick(r, ['phone', 'tel', 'telephone']) || undefined,
          email: email || undefined,
          industry: pick(r, ['industry']) || undefined,
          paymentTerm: pick(r, ['paymentterm', 'payment term', 'terms']) || undefined,
        },
      });
      names.add(companyName.toLowerCase());
      if (email) emails.add(email.toLowerCase());
      created++;
      results.push({ row: rowNum, status: 'created', label: companyName });
    }

    await this.audit.log({ userId, action: 'IMPORT', entityType: 'customer', detail: { total: rows.length, created } });
    return { total: rows.length, created, skipped: rows.length - created, results };
  }

  async importVendors(csv: string, userId?: string): Promise<ImportSummary> {
    const rows = this.parse(csv);
    const results: ImportRowResult[] = [];
    let created = 0;

    const existing = await this.prisma.vendor.findMany({ where: { deletedAt: null }, select: { name: true, email: true } });
    const names = new Set(existing.map((v) => v.name.toLowerCase()));
    const emails = new Set(existing.filter((v) => v.email).map((v) => v.email!.toLowerCase()));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const name = pick(r, ['name', 'vendor', 'vendor name', 'company']);
      const email = pick(r, ['email', 'e-mail']);
      if (!name) { results.push({ row: rowNum, status: 'skipped', reason: 'missing name' }); continue; }
      if (email && !EMAIL_RE.test(email)) { results.push({ row: rowNum, status: 'skipped', reason: `invalid email "${email}"`, label: name }); continue; }
      if (names.has(name.toLowerCase())) { results.push({ row: rowNum, status: 'skipped', reason: 'duplicate name', label: name }); continue; }
      if (email && emails.has(email.toLowerCase())) { results.push({ row: rowNum, status: 'skipped', reason: 'duplicate email', label: name }); continue; }

      const code = await this.seq.next('vendor');
      await this.prisma.vendor.create({
        data: {
          code, name,
          contactPerson: pick(r, ['contactperson', 'contact person', 'contact', 'pic']) || undefined,
          phone: pick(r, ['phone', 'tel', 'telephone']) || undefined,
          email: email || undefined,
          paymentTerm: pick(r, ['paymentterm', 'payment term', 'terms']) || undefined,
        },
      });
      names.add(name.toLowerCase());
      if (email) emails.add(email.toLowerCase());
      created++;
      results.push({ row: rowNum, status: 'created', label: name });
    }

    await this.audit.log({ userId, action: 'IMPORT', entityType: 'vendor', detail: { total: rows.length, created } });
    return { total: rows.length, created, skipped: rows.length - created, results };
  }

  private parse(csv: string) {
    if (!csv || !csv.trim()) throw new BadRequestException('CSV content is empty');
    const rows = parseCsv(csv);
    if (rows.length === 0) throw new BadRequestException('CSV has no data rows');
    if (rows.length > 5000) throw new BadRequestException('CSV exceeds 5000 rows — split the file');
    return rows;
  }
}

/** First non-empty value among the candidate header keys. */
function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] && row[k].trim()) return row[k].trim();
  }
  return '';
}
