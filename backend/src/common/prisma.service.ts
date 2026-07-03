import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Warn when a single query takes longer than this (ms). */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 1000);

@Injectable()
export class PrismaService
  extends PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma');

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
  }

  async onModuleInit() {
    // Surface slow queries so N+1s and missing indexes are visible in the logs.
    this.$on('query', (e) => {
      if (e.duration >= SLOW_QUERY_MS) {
        this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
      }
    });
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
