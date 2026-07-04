import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma.service';
import { MetricsService } from './metrics.service';

/**
 * Public (no JWT) health endpoints for uptime monitors, container
 * healthchecks and load balancers. @SkipThrottle so frequent polling never
 * trips the rate limiter.
 *
 * Three endpoints, matching the k8s probe model:
 * - GET /health       full report (DB + memory + uptime) for dashboards
 * - GET /health/live  liveness: is the process up? (never touches the DB, so
 *                     a DB blip can't trigger a pod restart)
 * - GET /health/ready readiness: can we serve traffic? (checks DB; returns
 *                     503 when unreachable so the LB drains this instance)
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, private metrics: MetricsService) {}

  private async pingDb(): Promise<{ database: 'healthy' | 'unhealthy'; dbLatencyMs: number | null }> {
    try {
      const t = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: 'healthy', dbLatencyMs: Date.now() - t };
    } catch {
      return { database: 'unhealthy', dbLatencyMs: null };
    }
  }

  @Get()
  async health() {
    const { database, dbLatencyMs } = await this.pingDb();
    const mem = process.memoryUsage();
    return {
      status: database === 'healthy' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, dbLatencyMs },
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
    };
  }

  /** Liveness: process is running. Deliberately does not touch the DB. */
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: dependencies reachable. 503 when the DB is down so the LB drains us. */
  @Get('ready')
  async ready() {
    const { database, dbLatencyMs } = await this.pingDb();
    if (database !== 'healthy') {
      throw new ServiceUnavailableException({ status: 'not_ready', checks: { database } });
    }
    return { status: 'ready', checks: { database, dbLatencyMs } };
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
