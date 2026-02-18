import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './common/controllers/health.controller';
import { EaGatewayModule } from './modules/ea-gateway/ea-gateway.module';
import { BacktestModule } from './modules/backtest/backtest.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [CqrsModule.forRoot(), DatabaseModule, EaGatewayModule, BacktestModule, StrategyModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
