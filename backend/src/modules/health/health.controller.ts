import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma.service';
import { MetricsService } from './metrics.service';

/**
 * Public (no JWT) liveness/readiness endpoint for uptime monitors,
 * container healthchecks and load balancers. @SkipThrottle so frequent
 * polling never trips the rate limiter.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private metrics: MetricsService) {}

  @Get()
  async health() {
    let database: 'healthy' | 'unhealthy' = 'healthy';
    let dbLatencyMs: number | null = null;
    try {
      const t = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t;
    } catch {
      database = 'unhealthy';
    }
    const mem = process.memoryUsage();
    return {
      status: database === 'healthy' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, dbLatencyMs },
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
    };
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
