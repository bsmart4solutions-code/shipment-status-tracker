import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = (exceptionResponse as any).message || exception.message;
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
