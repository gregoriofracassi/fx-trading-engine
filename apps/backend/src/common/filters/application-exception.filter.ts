import { ExceptionFilter, Catch, ArgumentsHost, Logger, HttpException } from '@nestjs/common';
import { Response } from 'express';

/**
 * Maps named domain exception classes to HTTP status codes.
 * Add entries here as new domain exceptions are created.
 */
const EXCEPTION_STATUS_MAP: Record<string, number> = {
  // Backtest module exceptions
  BackfillNotFoundException: 404,
  ChunkValidationException: 400,
};

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApplicationExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Let NestJS HttpExceptions pass through with their own status
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    if (exception instanceof Error) {
      const status = EXCEPTION_STATUS_MAP[exception.name] ?? 500;
      if (status >= 500) {
        this.logger.error(exception.message, exception.stack);
      }
      response.status(status).json({
        statusCode: status,
        error: exception.name,
        message: exception.message,
      });
      return;
    }

    this.logger.error('Unknown exception', JSON.stringify(exception));
    response.status(500).json({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    });
  }
}
