import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './common/controllers/health.controller';
import { EaGatewayModule } from './modules/ea-gateway/ea-gateway.module';

@Module({
  imports: [CqrsModule.forRoot(), DatabaseModule, EaGatewayModule],
  controllers: [HealthController],
})
export class AppModule {}
