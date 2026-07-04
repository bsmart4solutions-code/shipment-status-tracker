import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestContext } from '../request-context';

/** Seeds the AsyncLocalStorage request context (IP, User-Agent) for the whole request chain. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    requestContext.run(
      {
        ip: req.ip || req.socket?.remoteAddress || undefined,
        userAgent: req.headers['user-agent'],
      },
      next,
    );
  }
}
