import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from '../../modules/health/metrics.service';

/** Feeds MetricsService. Health endpoints are excluded so monitors don't skew stats. */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // req.path is prefix-stripped while inside the mounted middleware stack;
    // originalUrl is stable, so use it for both the exclusion and the sample.
    const url = (req.originalUrl || req.url).split('?')[0];
    if (url.startsWith('/api/health')) return next();
    const start = Date.now();
    res.on('finish', () => {
      this.metrics.record({
        method: req.method,
        path: url,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        at: new Date().toISOString(),
      });
    });
    next();
  }
}
