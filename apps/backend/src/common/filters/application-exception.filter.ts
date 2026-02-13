import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';

/**
 * Maps named domain exception classes to HTTP status codes.
 * Add entries here as new domain exceptions are created.
 */
const EXCEPTION_STATUS_MAP: Record<string, number> = {
  // Example: NotFoundException: 404
};

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof Error) {
      const status = EXCEPTION_STATUS_MAP[exception.name] ?? 500;
      response.status(status).json({
        statusCode: status,
        error: exception.name,
        message: exception.message,
      });
      return;
    }

    response.status(500).json({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    });
  }
}
