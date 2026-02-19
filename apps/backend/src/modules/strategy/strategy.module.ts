import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '../../database/database.module';
import { EaGatewayModule } from '../ea-gateway/ea-gateway.module';
import { AsiaRangeRepository } from './domain/repositories/asia-range.repository';
import { SignalRepository } from './domain/repositories/signal.repository';
import { AsiaRangeService } from './domain/services/asia-range.service';
import { S1DetectorService } from './domain/services/s1-detector.service';
import { S1SignalService } from './domain/services/s1-signal.service';
import { AdminController } from './controllers/admin.controller';
import { BarM15ClosedHandler } from './events/handlers/bar-m15-closed.handler';
import { ReplayAsiaRangeHandler } from './commands/handlers/replay-asia-range.handler';
import { ReplayS1SignalsHandler } from './commands/handlers/replay-s1-signals.handler';

const EventHandlers = [BarM15ClosedHandler];
const CommandHandlers = [ReplayAsiaRangeHandler, ReplayS1SignalsHandler];
const Services = [AsiaRangeService, S1DetectorService, S1SignalService];
const Repositories = [AsiaRangeRepository, SignalRepository];

@Module({
  imports: [CqrsModule, DatabaseModule, EaGatewayModule],
  controllers: [AdminController],
  providers: [...EventHandlers, ...CommandHandlers, ...Services, ...Repositories],
})
export class StrategyModule {}
