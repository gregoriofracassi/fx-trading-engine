import { Controller, Post, Body } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReplayAsiaRangeDto } from '../dto/requests/replay-asia-range.dto';
import { ReplayS1SignalsDto } from '../dto/requests/replay-s1-signals.dto';
import { ReplayAsiaRangeCommand } from '../commands/impl/replay-asia-range.command';
import { ReplayAsiaRangeResult } from '../commands/handlers/replay-asia-range.handler';
import { ReplayS1SignalsCommand } from '../commands/impl/replay-s1-signals.command';
import { ReplayS1SignalsResult } from '../commands/handlers/replay-s1-signals.handler';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('replay-asia-range')
  @ApiOperation({
    summary: 'Populate AsiaRange from existing BarM15 rows for a symbol',
  })
  async replayAsiaRange(@Body() dto: ReplayAsiaRangeDto): Promise<ReplayAsiaRangeResult> {
    return this.commandBus.execute(new ReplayAsiaRangeCommand(dto.symbol));
  }

  @Post('replay-s1-signals')
  @ApiOperation({
    summary: 'Detect S1 signals from existing BarM15 rows for a symbol',
  })
  async replayS1Signals(@Body() dto: ReplayS1SignalsDto): Promise<ReplayS1SignalsResult> {
    return this.commandBus.execute(new ReplayS1SignalsCommand(dto.symbol));
  }
}
