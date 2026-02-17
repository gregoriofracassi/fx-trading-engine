import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { ProcessBarM15Command } from '../impl/process-bar-m15.command';
import { BarM15Repository } from '../../domain/repositories/bar-m15.repository';
import { AuditEventRepository } from '../../domain/repositories/audit-event.repository';

@CommandHandler(ProcessBarM15Command)
export class ProcessBarM15Handler implements ICommandHandler<ProcessBarM15Command> {
  private readonly logger = new Logger(ProcessBarM15Handler.name);

  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly auditEventRepository: AuditEventRepository,
  ) {}

  async execute(command: ProcessBarM15Command): Promise<void> {
    await this.barM15Repository.upsert({
      symbol: command.symbol,
      timeOpen: command.timeOpen,
      timeClose: command.timeClose,
      open: command.open,
      high: command.high,
      low: command.low,
      close: command.close,
      tickVolume: command.tickVolume,
      spreadPoints: command.spreadPoints,
      source: 'FTMO_LIVE',
    });

    await this.auditEventRepository.create({
      terminalId: command.terminalId,
      type: 'BAR_M15_CLOSED',
      sequenceNum: command.seq,
      sentAt: command.sentAt,
      payload: {
        symbol: command.symbol,
        timeOpen: command.timeOpen.toISOString(),
        timeClose: command.timeClose.toISOString(),
        open: command.open,
        high: command.high,
        low: command.low,
        close: command.close,
        tickVolume: command.tickVolume,
        spreadPoints: command.spreadPoints,
      },
    });

    this.logger.log(
      `[${command.terminalId}] BAR_M15_CLOSED | ${command.symbol} | timeOpen=${command.timeOpen.toISOString()} | seq=${command.seq ?? '-'}`,
    );
  }
}
