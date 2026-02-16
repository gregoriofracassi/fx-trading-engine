import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '../../database/database.module';
import { EaGatewayController } from './controllers/ea-gateway.controller';
import { ProcessEaEventHandler } from './commands/handlers/process-ea-event.handler';
import { AuditEventRepository } from './domain/repositories/audit-event.repository';
import { EaGatewayService } from './domain/services/ea-gateway.service';

const CommandHandlers = [ProcessEaEventHandler];
const Services = [EaGatewayService];

@Module({
  imports: [CqrsModule, DatabaseModule],
  controllers: [EaGatewayController],
  providers: [...CommandHandlers, ...Services, AuditEventRepository],
})
export class EaGatewayModule {}
