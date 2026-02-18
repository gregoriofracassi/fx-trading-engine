import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '../../database/database.module';
import { EaGatewayModule } from '../ea-gateway/ea-gateway.module';
import { AsiaRangeRepository } from './domain/repositories/asia-range.repository';
import { AsiaRangeService } from './domain/services/asia-range.service';
import { AdminController } from './controllers/admin.controller';
import { BarM15ClosedHandler } from './events/handlers/bar-m15-closed.handler';

const EventHandlers = [BarM15ClosedHandler];
const Services = [AsiaRangeService];
const Repositories = [AsiaRangeRepository];

@Module({
  imports: [CqrsModule, DatabaseModule, EaGatewayModule],
  controllers: [AdminController],
  providers: [...EventHandlers, ...Services, ...Repositories],
})
export class StrategyModule {}
