import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const statusCode = res.statusCode;

      const logData = {
        method: req.method,
        path: req.path,
        statusCode,
        duration: `${duration}ms`,
      };

      if (statusCode >= 500) {
        this.logger.error(`${req.method} ${req.path}`, logData);
      } else if (statusCode >= 400) {
        this.logger.warn(`${req.method} ${req.path}`, logData);
      } else {
        this.logger.debug(`${req.method} ${req.path}`, logData);
      }
    });

    next();
  }
}
