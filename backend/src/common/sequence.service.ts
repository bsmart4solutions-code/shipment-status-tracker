import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Configurable auto-numbering. Formats come from the `sequences` table
 * (prefix, zero padding, optional per-year scope), e.g.
 *   customer  -> CUST-0001
 *   quotation -> QT-2026-0001 (counter resets each year)
 * Runs inside a transaction with a row lock to guarantee uniqueness
 * under concurrent requests.
 */
@Injectable()
export class SequenceService {
  constructor(private prisma: PrismaService) {}

  async next(key: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { key: string; prefix: string; padding: number; includeYear: boolean; nextValue: number; yearScope: number | null }[]
      >`SELECT * FROM sequences WHERE key = ${key} FOR UPDATE`;
      if (!rows.length) throw new Error(`Sequence "${key}" is not configured`);
      const seq = rows[0];
      const year = new Date().getFullYear();
      let value = seq.nextValue;
      if (seq.includeYear && seq.yearScope !== year) value = 1; // new year -> reset counter
      await tx.sequence.update({
        where: { key },
        data: { nextValue: value + 1, yearScope: seq.includeYear ? year : null },
      });
      const num = String(value).padStart(seq.padding, '0');
      return seq.includeYear ? `${seq.prefix}-${year}-${num}` : `${seq.prefix}-${num}`;
    });
  }
}
