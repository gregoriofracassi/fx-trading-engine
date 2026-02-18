import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, body } = req;
    const start = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const ms = Date.now() - start;
      const level = statusCode >= 400 ? 'error' : 'log';

      if (level === 'error') {
        this.logger.error(
          `${method} ${originalUrl} ${statusCode} ${ms}ms — body: ${JSON.stringify(body)}`,
        );
      } else {
        this.logger.log(`${method} ${originalUrl} ${statusCode} ${ms}ms`);
      }
    });

    next();
  }
}
