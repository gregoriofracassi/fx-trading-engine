import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '../../database/database.module';
import { EaGatewayController } from './controllers/ea-gateway.controller';
import { ProcessEaEventHandler } from './commands/handlers/process-ea-event.handler';
import { AuditEventRepository } from './domain/repositories/audit-event.repository';

const CommandHandlers = [ProcessEaEventHandler];

@Module({
  imports: [CqrsModule, DatabaseModule],
  controllers: [EaGatewayController],
  providers: [...CommandHandlers, AuditEventRepository],
})
export class EaGatewayModule {}
