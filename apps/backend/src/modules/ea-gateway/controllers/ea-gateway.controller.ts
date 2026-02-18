import {
  Body,
  Controller,
  Post,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  ParseArrayPipe,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { EaEventDto } from '../dto/requests/ea-event.dto';
import { ProcessEaEventCommand } from '../commands/impl/process-ea-event.command';
import { ProcessBarM15Command } from '../commands/impl/process-bar-m15.command';
import { GetLastBarQuery } from '../queries/impl/get-last-bar.query';
import { LastBarResult } from '../queries/handlers/get-last-bar.handler';

@ApiTags('ea-gateway')
@Controller('ea')
export class EaGatewayController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive events from EA (bar close, trade events) — accepts an array' })
  @ApiBody({ type: [EaEventDto] })
  async receiveEvents(
    @Body(new ParseArrayPipe({ items: EaEventDto, whitelist: true, forbidNonWhitelisted: true }))
    events: EaEventDto[],
  ): Promise<{ received: true }> {
    for (const dto of events) {
      if (dto.type === 'BAR_M15_CLOSED') {
        await this.commandBus.execute(
          new ProcessBarM15Command(
            dto.terminalId,
            dto.symbol!,
            dto.timeOpen!,
            dto.timeClose!,
            dto.open!,
            dto.high!,
            dto.low!,
            dto.close!,
            dto.tickVolume!,
            dto.spreadPoints!,
            dto.seq,
            dto.sentAt,
          ),
        );
      } else {
        const payload = { ...dto } as Record<string, unknown>;
        await this.commandBus.execute(
          new ProcessEaEventCommand(dto.terminalId, dto.type, dto.seq, dto.sentAt, payload),
        );
      }
    }

    return { received: true };
  }

  @Get('last-bar')
  @ApiOperation({
    summary:
      'Get the most recent BarM15 timeOpen for a symbol (used by EA for backfill on reconnect)',
  })
  @ApiQuery({ name: 'symbol', example: 'EURUSD' })
  async getLastBar(@Query('symbol') symbol: string): Promise<LastBarResult> {
    return this.queryBus.execute(new GetLastBarQuery(symbol));
  }
}
