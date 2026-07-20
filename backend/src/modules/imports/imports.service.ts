import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { parseCsv } from '../../common/csv-parse.util';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { detectCurrency, extractRates, ParsedRate, RATE_SHEET_LIMITS } from './rate-sheet.parser';

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

  /**
   * Import ocean/vendor rate rows (already parsed from Excel in the browser)
   * into VendorServiceRate. Each row is one lane+container line. Dedupe key is
   * vendor+service+origin+destination+containerType+effectiveDate so
   * re-importing the same month's sheet is idempotent.
   */
  async importRates(dto: ImportRatesInput, userId?: string): Promise<ImportSummary> {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, deletedAt: null }, select: { id: true, name: true } });
    if (!vendor) throw new BadRequestException('Vendor not found');
    const service = await this.prisma.service.findFirst({ where: { id: dto.serviceId, deletedAt: null }, select: { id: true } });
    if (!service) throw new BadRequestException('Service not found');
    if (!Array.isArray(dto.rows) || dto.rows.length === 0) throw new BadRequestException('No rate rows to import');
    if (dto.rows.length > 5000) throw new BadRequestException('Too many rows — split the file');

    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();
    const currency = (dto.currency || 'USD').toUpperCase();

    // Pre-load existing rates for this vendor+service to dedupe within the effective month.
    const existing = await this.prisma.vendorServiceRate.findMany({
      where: { vendorId: dto.vendorId, serviceId: dto.serviceId },
      select: { origin: true, destination: true, containerType: true, effectiveDate: true },
    });
    const key = (o?: string | null, d?: string | null, c?: string | null, e?: Date) =>
      `${(o ?? '').toLowerCase()}|${(d ?? '').toLowerCase()}|${(c ?? '').toLowerCase()}|${e ? e.toISOString().slice(0, 10) : ''}`;
    const seen = new Set(existing.map((r) => key(r.origin, r.destination, r.containerType, r.effectiveDate)));

    const results: ImportRowResult[] = [];
    let created = 0;
    for (let i = 0; i < dto.rows.length; i++) {
      const r = dto.rows[i];
      const rowNum = i + 1;
      const label = [r.origin, r.destination, r.containerType].filter(Boolean).join(' → ');
      const cost = Number(r.cost);
      if (!r.destination) { results.push({ row: rowNum, status: 'skipped', reason: 'missing destination', label }); continue; }
      if (!Number.isFinite(cost) || cost < 0) { results.push({ row: rowNum, status: 'skipped', reason: `invalid cost "${r.cost}"`, label }); continue; }
      // Dedupe only against rates already in the DB (idempotent re-import) —
      // do NOT collapse distinct rows within the same sheet, since a lane can
      // legitimately have several rates (e.g. the same POD via different carriers).
      const k = key(r.origin, r.destination, r.containerType, effectiveDate);
      if (seen.has(k)) { results.push({ row: rowNum, status: 'skipped', reason: 'already imported for this effective date', label }); continue; }

      await this.prisma.vendorServiceRate.create({
        data: {
          vendorId: dto.vendorId,
          serviceId: dto.serviceId,
          origin: r.origin || undefined,
          destination: r.destination,
          containerType: r.containerType || undefined,
          rateType: r.containerType ? 'PER_CONTAINER' : 'FIXED',
          currency,
          cost,
          minimumCharge: r.minimumCharge != null && Number.isFinite(Number(r.minimumCharge)) ? Number(r.minimumCharge) : undefined,
          effectiveDate,
          remarks: r.remarks || undefined,
        },
      });
      // Deliberately not adding k to `seen`: distinct rows in the same upload
      // that share a lane+container (carrier alternates) should all import.
      created++;
      results.push({ row: rowNum, status: 'created', label });
    }

    await this.audit.log({ userId, action: 'IMPORT', entityType: 'rate', detail: { vendor: vendor.name, total: dto.rows.length, created } });
    return { total: dto.rows.length, created, skipped: dto.rows.length - created, results };
  }

  private parse(csv: string) {
    if (!csv || !csv.trim()) throw new BadRequestException('CSV content is empty');
    const rows = parseCsv(csv);
    if (rows.length === 0) throw new BadRequestException('CSV has no data rows');
    if (rows.length > 5000) throw new BadRequestException('CSV exceeds 5000 rows — split the file');
    return rows;
  }

  /**
   * Parse an uploaded carrier rate workbook server-side (Sprint 02, P0-6 —
   * untrusted spreadsheets never touch the browser's parser). Returns the
   * preview rows the client shows before committing via importRates().
   */
  async parseRateSheet(file: Express.Multer.File, userId?: string): Promise<{ rows: ParsedRate[]; warnings: string[]; currency?: string }> {
    if (!file || !file.buffer?.length) throw new BadRequestException('No file uploaded');
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx')) {
      throw new BadRequestException('Only .xlsx workbooks are supported — re-save .xls files as .xlsx first');
    }

    // exceljs is heavy; load it only when a parse actually runs.
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Could not read this file as an Excel workbook');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets');
    if (ws.rowCount > RATE_SHEET_LIMITS.maxRows) {
      throw new BadRequestException(`Sheet exceeds ${RATE_SHEET_LIMITS.maxRows} rows — split the file`);
    }

    const warnings: string[] = [];
    if (ws.columnCount > RATE_SHEET_LIMITS.maxCols) {
      warnings.push(`Only the first ${RATE_SHEET_LIMITS.maxCols} columns were read`);
    }

    // Flatten to the same 2D grid shape the extraction logic has always used.
    const grid: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const raw = row.values as unknown[]; // exceljs row.values is 1-based
      grid.push(raw.slice(1, RATE_SHEET_LIMITS.maxCols + 1).map(cellValue));
    });

    const rows = extractRates(grid);
    if (rows.length === 0) {
      warnings.push('Could not find a POL/POD rate table in this sheet. Check the first tab has a header row with POL and POD columns.');
    }
    await this.audit.log({ userId, action: 'PARSE', entityType: 'rate', detail: { file: file.originalname, rows: rows.length } });
    return { rows, warnings, currency: detectCurrency(grid) };
  }
}

/** Normalize an exceljs cell value to the primitive the grid logic expects. */
function cellValue(v: unknown): unknown {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; hyperlink?: unknown };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if ('result' in o) return cellValue(o.result); // formula cell -> cached result
    if ('text' in o) return cellValue(o.text); // hyperlink cell
    return '';
  }
  return v;
}

export interface RateImportRow {
  origin?: string;
  destination?: string;
  containerType?: string;
  cost: number;
  minimumCharge?: number;
  remarks?: string;
}

export interface ImportRatesInput {
  vendorId: string;
  serviceId: string;
  currency?: string;
  effectiveDate?: string;
  rows: RateImportRow[];
}

/** First non-empty value among the candidate header keys. */
function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] && row[k].trim()) return row[k].trim();
  }
  return '';
}
