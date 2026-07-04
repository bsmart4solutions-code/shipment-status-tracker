import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Per-request context carried via AsyncLocalStorage so deep service code
 * (e.g. AuditService) can read the caller's IP / User-Agent without every
 * controller having to thread the request object through its services.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
