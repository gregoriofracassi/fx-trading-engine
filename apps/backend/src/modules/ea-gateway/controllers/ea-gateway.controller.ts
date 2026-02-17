import {
  Body,
  Controller,
  Post,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EaEventDto } from '../dto/requests/ea-event.dto';
import { ProcessEaEventCommand } from '../commands/impl/process-ea-event.command';
import { ProcessBarM15Command } from '../commands/impl/process-bar-m15.command';
import { BarM15Repository } from '../domain/repositories/bar-m15.repository';
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
  @ApiOperation({ summary: 'Receive events from EA (heartbeat, bar close, trade events)' })
  async receiveEvent(@Body() dto: EaEventDto): Promise<{ received: true }> {
    if (dto.type === 'BAR_M15_CLOSED') {
      if (
        !dto.symbol ||
        !dto.timeOpen ||
        !dto.timeClose ||
        dto.o === undefined ||
        dto.h === undefined ||
        dto.l === undefined ||
        dto.c === undefined ||
        dto.tickVolume === undefined ||
        dto.spreadPoints === undefined
      ) {
        throw new BadRequestException('BAR_M15_CLOSED event missing required bar fields');
      }

      await this.commandBus.execute(
        new ProcessBarM15Command(
          dto.terminalId,
          dto.symbol,
          BarM15Repository.parseMT5Date(dto.timeOpen),
          BarM15Repository.parseMT5Date(dto.timeClose),
          dto.o,
          dto.h,
          dto.l,
          dto.c,
          dto.tickVolume,
          dto.spreadPoints,
          dto.seq,
          dto.sentAt ? BarM15Repository.parseMT5Date(dto.sentAt) : undefined,
        ),
      );
    } else {
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
