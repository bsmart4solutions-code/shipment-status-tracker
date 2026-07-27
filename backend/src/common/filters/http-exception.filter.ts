import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

/** Human labels for the columns that carry a unique constraint. */
const FIELD_LABELS: Record<string, string> = {
  vendorInvoiceNo: "vendor's invoice number",
  billNumber: 'bill number',
  invoiceNumber: 'invoice number',
  noteNumber: 'note number',
  quoteNumber: 'quotation number',
  jobNumber: 'job number',
  code: 'code',
  email: 'email address',
  name: 'name',
};

/**
 * Named indexes whose column list would not read well on its own — notably
 * partial indexes, where Prisma reports the index name instead of columns.
 */
const INDEX_MESSAGES: Record<string, string> = {
  vendor_bills_vendor_invoice_active_key:
    "This vendor's invoice number is already recorded on an active bill — void that bill first if you need to re-enter it",
};

/**
 * Prisma P2002 (unique constraint failed) → an actionable 409 message.
 * Detected structurally rather than by importing the Prisma error class, so
 * the filter stays free of a runtime dependency on the client package.
 */
function uniqueConstraintMessage(exception: unknown): string | null {
  const e = exception as { code?: string; meta?: { target?: unknown; modelName?: string } };
  if (!e || e.code !== 'P2002') return null;

  const target = e.meta?.target;
  if (typeof target === 'string' && INDEX_MESSAGES[target]) return INDEX_MESSAGES[target];
  if (Array.isArray(target) && target.length === 1 && INDEX_MESSAGES[String(target[0])]) {
    return INDEX_MESSAGES[String(target[0])];
  }
  // `target` is a column list on most databases, or an index name on some.
  const columns = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  const known = columns.filter((c) => FIELD_LABELS[c]).map((c) => FIELD_LABELS[c]);

  if (known.length === 0) return 'A record with these details already exists';
  if (known.length === 1) return `A record with this ${known[0]} already exists`;
  return `A record with this ${known.slice(0, -1).join(', ')} and ${known[known.length - 1]} already exists`;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    const duplicate = uniqueConstraintMessage(exception);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = (exceptionResponse as any).message || exception.message;
    } else if (duplicate) {
      // A unique-constraint violation is a conflict, not a server fault. It
      // reaches here when a check-then-insert loses a race, so the client gets
      // the same 409 it would have received from the service's own check.
      status = HttpStatus.CONFLICT;
      message = duplicate;
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled ${exception.constructor.name}: ${exception.message}`,
        exception.stack,
        { path: request.path }
      );
      message = process.env.NODE_ENV === 'production' ? 'Internal server error' : exception.message;
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
    });
  }
}
