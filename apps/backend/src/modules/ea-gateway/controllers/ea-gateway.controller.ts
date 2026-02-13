import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EaEventDto } from '../dto/requests/ea-event.dto';
import { ProcessEaEventCommand } from '../commands/impl/process-ea-event.command';

@ApiTags('ea-gateway')
@Controller('ea')
export class EaGatewayController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive events from EA (heartbeat, bar close, trade events)' })
  async receiveEvent(@Body() dto: EaEventDto): Promise<{ received: true }> {
    const payload = { ...dto } as Record<string, unknown>;

    await this.commandBus.execute(
      new ProcessEaEventCommand(
        dto.terminalId,
        dto.type,
        dto.seq,
        dto.sentAt ? new Date(dto.sentAt) : undefined,
        payload,
      ),
    );

    return { received: true };
  }
}
