import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected errorMessage = 'Rate limit exceeded. Please try again later.';

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    return req.user?.id ? `${req.user.id}:${ip}` : ip;
  }
}
