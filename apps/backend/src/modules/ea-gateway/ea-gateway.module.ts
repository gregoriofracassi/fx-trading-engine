import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '../../database/database.module';
import { BacktestModule } from '../backtest/backtest.module';
import { EaGatewayController } from './controllers/ea-gateway.controller';
import { ProcessEaEventHandler } from './commands/handlers/process-ea-event.handler';
import { ProcessBarM15Handler } from './commands/handlers/process-bar-m15.handler';
import { GetLastBarHandler } from './queries/handlers/get-last-bar.handler';
import { AuditEventRepository } from './domain/repositories/audit-event.repository';
import { BarM15Repository } from './domain/repositories/bar-m15.repository';
import { EaGatewayService } from './domain/services/ea-gateway.service';

const CommandHandlers = [ProcessEaEventHandler, ProcessBarM15Handler];
const QueryHandlers = [GetLastBarHandler];
const Services = [EaGatewayService];
const Repositories = [AuditEventRepository, BarM15Repository];

@Module({
  imports: [CqrsModule, DatabaseModule, BacktestModule],
  controllers: [EaGatewayController],
  providers: [...CommandHandlers, ...QueryHandlers, ...Services, ...Repositories],
  exports: [BarM15Repository],
})
export class EaGatewayModule {}
