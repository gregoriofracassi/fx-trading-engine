import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { ProcessEaEventCommand } from '../impl/process-ea-event.command';
import { AuditEventRepository } from '../../domain/repositories/audit-event.repository';

@CommandHandler(ProcessEaEventCommand)
export class ProcessEaEventHandler implements ICommandHandler<ProcessEaEventCommand> {
  private readonly logger = new Logger(ProcessEaEventHandler.name);

  constructor(private readonly auditEventRepository: AuditEventRepository) {}

  async execute(command: ProcessEaEventCommand): Promise<void> {
    if (command.type !== 'HEARTBEAT') {
      await this.auditEventRepository.create({
        terminalId: command.terminalId,
        type: command.type,
        sequenceNum: command.sequenceNum,
        sentAt: command.sentAt,
        payload: command.payload,
      });
    }

    this.logger.log(`[${command.terminalId}] ${command.type} seq=${command.sequenceNum ?? '-'}`);
  }
}
