import { Injectable } from '@nestjs/common';

interface RequestSample {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  at: string;
}

/**
 * In-memory request metrics. Singleton — updated by MetricsMiddleware,
 * read by HealthController. Health-check traffic is excluded so uptime
 * monitors don't skew the numbers.
 */
@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private totalRequests = 0;
  private statusClasses: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  private recent: RequestSample[] = []; // rolling window, newest last

  private static readonly WINDOW = 200;

  record(sample: RequestSample) {
    this.totalRequests++;
    const cls = `${Math.floor(sample.statusCode / 100)}xx`;
    if (this.statusClasses[cls] !== undefined) this.statusClasses[cls]++;
    this.recent.push(sample);
    if (this.recent.length > MetricsService.WINDOW) this.recent.shift();
  }

  snapshot() {
    const durations = this.recent.map((r) => r.durationMs).sort((a, b) => a - b);
    const pct = (p: number) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))] : 0);
    const avg = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
    const errors = this.statusClasses['4xx'] + this.statusClasses['5xx'];
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      totalRequests: this.totalRequests,
      statusClasses: { ...this.statusClasses },
      errorRatePct: this.totalRequests ? Number(((errors / this.totalRequests) * 100).toFixed(2)) : 0,
      window: {
        size: this.recent.length,
        avgMs: avg,
        p50Ms: pct(50),
        p95Ms: pct(95),
        maxMs: durations[durations.length - 1] ?? 0,
      },
      slowest: [...this.recent].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
    };
  }
}
