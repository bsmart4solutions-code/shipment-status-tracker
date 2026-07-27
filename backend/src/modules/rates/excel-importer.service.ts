import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

interface ImportRate {
  vendorId: string;
  serviceId: string;
  origin?: string;
  destination?: string;
  country?: string;
  rateType: string;
  currency: string;
  cost: number;
  minimumCharge?: number | null;
  availability: string;
  viaPort?: string;
  transitDays?: string;
  freightCollect?: boolean;
  weightRatio?: number;
  surcharges?: Record<string, unknown>[];
  effectiveDate: Date;
  expiryDate?: Date | null;
  remarks?: string;
}

@Injectable()
export class ExcelImporterService {
  constructor(private prisma: PrismaService) {}

  /**
   * Parse Excel file and import rates.
   * Detects format (Solid Xpress or ECU WW) automatically based on sheet name and headers.
   */
  async importRates(
    buffer: Buffer,
    vendorId: string,
    effectiveDate: Date = new Date(),
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    let result = { created: 0, updated: 0, errors: [] as string[] };

    try {
      const workbook = XLSX.read(buffer, { cellDates: true });

      // Detect format and parse accordingly
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];

        if (!rows.length) continue;

        if (sheetName.toUpperCase().includes('OCEAN FREIGHT')) {
          const r = await this.parseSolidXpressFormat(rows, vendorId, effectiveDate);
          result.created += r.created;
          result.updated += r.updated;
          result.errors.push(...r.errors);
        } else if (sheetName.toUpperCase().includes('EXPORT TARIFF')) {
          const r = await this.parseECUWWFormat(rows, vendorId, effectiveDate);
          result.created += r.created;
          result.updated += r.updated;
          result.errors.push(...r.errors);
        }
      }

      return result;
    } catch (error: any) {
      throw new BadRequestException(`Failed to parse Excel file: ${error?.message || String(error)}`);
    }
  }

  /**
   * Parse Solid Xpress/Globelink Ocean Freight sheet.
   * Headers (row 22): destination, rate PER W/M, min M3, surcharges, via ports, transit days, freight collect, effective date, remark
   */
  private async parseSolidXpressFormat(
    rows: Record<string, any>[],
    vendorId: string,
    effectiveDate: Date,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    const result = { created: 0, updated: 0, errors: [] as string[] };
    const seaFreightService = await this.prisma.service.findFirst({
      where: { name: { contains: 'Sea', mode: 'insensitive' } },
    });

    if (!seaFreightService) {
      result.errors.push('Sea Freight service not found');
      return result;
    }

    // Normalize header names to handle variations
    const headerMap = this.normalizeHeaders(rows[0]);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 23; // Account for header row

      try {
        // Skip empty rows
        if (!row.destination && !row.Destination) continue;

        const destination = this.getCellValue(row, ['destination', 'Destination']);
        if (!destination) continue;

        const rateStr = this.getCellValue(row, ['rate', 'Rate', 'Cost', 'cost']);
        const minM3Str = this.getCellValue(row, ['min', 'Min', 'minimumCharge', 'MinimumCharge']);
        const viaPorts = this.getCellValue(row, ['via', 'Via', 'viaPort', 'ViaPort']);
        const transitDays = this.getCellValue(row, ['transit', 'Transit', 'transitDays', 'TransitDays']);
        const freightCollectStr = this.getCellValue(row, ['collect', 'Collect', 'freightCollect', 'FreightCollect']);
        const remarks = this.getCellValue(row, ['remark', 'Remark', 'remarks', 'Remarks']);

        // Parse cost: handle "F.O.C" and negative values
        let cost = 0;
        if (rateStr && rateStr.toUpperCase() !== 'F.O.C' && rateStr.toUpperCase() !== 'ON REQUEST') {
          cost = parseFloat(rateStr);
          if (isNaN(cost)) {
            result.errors.push(`Row ${lineNum}: Invalid rate value "${rateStr}"`);
            continue;
          }
        }

        // Parse minimum charge
        let minimumCharge: number | null = null;
        if (minM3Str && minM3Str.toUpperCase() !== 'F.O.C') {
          minimumCharge = parseFloat(minM3Str);
          if (isNaN(minimumCharge)) minimumCharge = null;
        }

        // Determine availability
        let availability = 'AVAILABLE';
        if (rateStr?.toUpperCase() === 'ON REQUEST') availability = 'ON_REQUEST';
        else if (remarks?.toUpperCase().includes('SUSPEND')) availability = 'SUSPENDED';

        // Infer country from destination
        const country = this.inferCountryFromDestination(destination);

        const rate: ImportRate = {
          vendorId,
          serviceId: seaFreightService.id,
          destination: destination.toUpperCase(),
          country: country || undefined,
          rateType: 'PER_WM',
          currency: 'USD', // Solid Xpress typically uses USD
          cost,
          minimumCharge,
          availability,
          viaPort: viaPorts || undefined,
          transitDays: transitDays || undefined,
          freightCollect: freightCollectStr?.toUpperCase() === 'Y',
          weightRatio: 333, // Solid Xpress uses 333 kg/CBM
          effectiveDate,
          remarks,
        };

        await this.upsertRate(rate);
        result.created++;
      } catch (error: any) {
        result.errors.push(`Row ${lineNum}: ${error?.message || String(error)}`);
      }
    }

    return result;
  }

  /**
   * Parse ECU Worldwide Export Tariff sheet.
   * Headers (row 11): ports, province, rate PER W/M, min M3, surcharges, via, transit days, freight collect
   */
  private async parseECUWWFormat(
    rows: Record<string, any>[],
    vendorId: string,
    effectiveDate: Date,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    const result = { created: 0, updated: 0, errors: [] as string[] };
    const seaFreightService = await this.prisma.service.findFirst({
      where: { name: { contains: 'Sea', mode: 'insensitive' } },
    });

    if (!seaFreightService) {
      result.errors.push('Sea Freight service not found');
      return result;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 12; // Account for header row

      try {
        // Skip empty rows
        const port = this.getCellValue(row, ['port', 'Port', 'origin', 'Origin']);
        if (!port) continue;

        const province = this.getCellValue(row, ['province', 'Province', 'destination', 'Destination']);
        const rateStr = this.getCellValue(row, ['rate', 'Rate', 'Cost', 'cost']);
        const minM3Str = this.getCellValue(row, ['min', 'Min', 'minimumCharge', 'MinimumCharge']);
        const viaPorts = this.getCellValue(row, ['via', 'Via', 'viaPort', 'ViaPort']);
        const transitDays = this.getCellValue(row, ['transit', 'Transit', 'transitDays', 'TransitDays']);
        const freightCollectStr = this.getCellValue(row, ['collect', 'Collect', 'freightCollect', 'FreightCollect']);
        const surchargStr = this.getCellValue(row, ['surcharge', 'Surcharge', 'surcharges', 'Surcharges']);

        // Parse cost
        let cost = 0;
        if (rateStr && rateStr.toUpperCase() !== 'F.O.C' && rateStr.toUpperCase() !== 'ON REQUEST') {
          cost = parseFloat(rateStr);
          if (isNaN(cost)) {
            result.errors.push(`Row ${lineNum}: Invalid rate value "${rateStr}"`);
            continue;
          }
        }

        // Parse minimum charge
        let minimumCharge: number | null = null;
        if (minM3Str && minM3Str.toUpperCase() !== 'F.O.C') {
          minimumCharge = parseFloat(minM3Str);
          if (isNaN(minimumCharge)) minimumCharge = null;
        }

        // Determine availability
        let availability = 'AVAILABLE';
        if (rateStr?.toUpperCase() === 'ON REQUEST') availability = 'ON_REQUEST';

        // Parse surcharges (if present as text)
        let surcharges: Record<string, unknown>[] | undefined;
        if (surchargStr) {
          try {
            surcharges = JSON.parse(surchargStr);
          } catch {
            // If not JSON, ignore
          }
        }

        const rate: ImportRate = {
          vendorId,
          serviceId: seaFreightService.id,
          origin: port.toUpperCase(),
          destination: province?.toUpperCase(),
          rateType: 'PER_WM',
          currency: 'USD', // ECU WW export tariff uses USD
          cost,
          minimumCharge,
          availability,
          viaPort: viaPorts || undefined,
          transitDays: transitDays || undefined,
          freightCollect: freightCollectStr?.toUpperCase() === 'Y',
          weightRatio: 333, // ECU WW uses 333 kg/CBM
          surcharges,
          effectiveDate,
        };

        await this.upsertRate(rate);
        result.created++;
      } catch (error: any) {
        result.errors.push(`Row ${lineNum}: ${error?.message || String(error)}`);
      }
    }

    return result;
  }

  /**
   * Upsert rate: update if exists by (vendorId, serviceId, origin, destination),
   * else create new.
   */
  private async upsertRate(rate: ImportRate): Promise<void> {
    const existing = await this.prisma.vendorServiceRate.findFirst({
      where: {
        vendorId: rate.vendorId,
        serviceId: rate.serviceId,
        origin: rate.origin || null,
        destination: rate.destination || null,
      },
    });

    if (existing) {
      await this.prisma.vendorServiceRate.update({
        where: { id: existing.id },
        data: {
          cost: new Prisma.Decimal(rate.cost),
          minimumCharge: rate.minimumCharge ? new Prisma.Decimal(rate.minimumCharge) : null,
          availability: rate.availability as any,
          viaPort: rate.viaPort,
          transitDays: rate.transitDays,
          freightCollect: rate.freightCollect,
          weightRatio: rate.weightRatio,
          surcharges: rate.surcharges ? JSON.stringify(rate.surcharges) : undefined,
          effectiveDate: rate.effectiveDate,
          expiryDate: rate.expiryDate,
          remarks: rate.remarks,
          updatedAt: new Date(),
        },
      });
    } else {
      await this.prisma.vendorServiceRate.create({
        data: {
          vendorId: rate.vendorId,
          serviceId: rate.serviceId,
          origin: rate.origin,
          destination: rate.destination,
          country: rate.country,
          rateType: 'PER_WM',
          currency: rate.currency,
          cost: new Prisma.Decimal(rate.cost),
          minimumCharge: rate.minimumCharge ? new Prisma.Decimal(rate.minimumCharge) : null,
          availability: rate.availability as any,
          viaPort: rate.viaPort,
          transitDays: rate.transitDays,
          freightCollect: rate.freightCollect,
          weightRatio: rate.weightRatio,
          surcharges: rate.surcharges ? JSON.stringify(rate.surcharges) : undefined,
          effectiveDate: rate.effectiveDate,
          expiryDate: rate.expiryDate,
          remarks: rate.remarks,
        },
      });
    }
  }

  /** Helper: get cell value from row by trying multiple key variations. */
  private getCellValue(row: Record<string, any>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = row[key];
      if (value !== undefined && value !== '' && value !== null) {
        return String(value).trim();
      }
    }
    return undefined;
  }

  /** Helper: normalize header names to handle variations in Excel files. */
  private normalizeHeaders(headerRow: Record<string, any>): Map<string, string> {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(headerRow)) {
      const normalized = String(value).toLowerCase().replace(/\s+/g, '_');
      map.set(normalized, key);
    }
    return map;
  }

  /** Infer country from destination name (e.g., "HO CHI MINH" -> "VIETNAM"). */
  private inferCountryFromDestination(destination: string): string | undefined {
    const dest = destination.toUpperCase();

    // Common port-to-country mappings
    const mappings: Record<string, string> = {
      'HO CHI MINH': 'VIETNAM',
      'HAIPHONG': 'VIETNAM',
      'BANGKOK': 'THAILAND',
      'SINGAPORE': 'SINGAPORE',
      'KUALA LUMPUR': 'MALAYSIA',
      'PORT KLANG': 'MALAYSIA',
      'JAKARTA': 'INDONESIA',
      'SURABAYA': 'INDONESIA',
      'MANILA': 'PHILIPPINES',
      'HONG KONG': 'HONG KONG',
      'SHANGHAI': 'CHINA',
      'SHENZHEN': 'CHINA',
      'XIAMEN': 'CHINA',
      'QINGDAO': 'CHINA',
      'BUSAN': 'KOREA',
      'INCHEON': 'KOREA',
      'TOKYO': 'JAPAN',
      'YOKOHAMA': 'JAPAN',
      'KOBE': 'JAPAN',
      'KAOHSIUNG': 'TAIWAN',
      'TAIPEI': 'TAIWAN',
      'AUSTRALIA': 'AUSTRALIA',
      'SYDNEY': 'AUSTRALIA',
      'MELBOURNE': 'AUSTRALIA',
      'INDIA': 'INDIA',
      'MUMBAI': 'INDIA',
      'COLOMBO': 'SRI LANKA',
      'DHAKA': 'BANGLADESH',
      'CHITTAGONG': 'BANGLADESH',
      'SUEZ': 'EGYPT',
      'EUROPE': 'EUROPE',
      'ROTTERDAM': 'NETHERLANDS',
      'HAMBURG': 'GERMANY',
      'ANTWERP': 'BELGIUM',
    };

    for (const [key, country] of Object.entries(mappings)) {
      if (dest.includes(key)) return country;
    }

    // Return destination as-is if no mapping found
    return destination;
  }
}
