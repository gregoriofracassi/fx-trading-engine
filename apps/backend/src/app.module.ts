import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './common/controllers/health.controller';
import { EaGatewayModule } from './modules/ea-gateway/ea-gateway.module';
import { BacktestModule } from './modules/backtest/backtest.module';

@Module({
  imports: [CqrsModule.forRoot(), DatabaseModule, EaGatewayModule, BacktestModule],
  controllers: [HealthController],
})
export class AppModule {}
