import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Typed access to the settings JSON store, with code-level fallbacks so nothing is hardcoded elsewhere. */
@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.settingKV.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }

  async set(key: string, value: unknown) {
    return this.prisma.settingKV.upsert({
      where: { key },
      update: { value: value as any },
      create: { key, value: value as any },
    });
  }

  async all() {
    return this.prisma.settingKV.findMany();
  }
}
