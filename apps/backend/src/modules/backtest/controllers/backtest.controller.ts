import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RunBacktestDto } from '../dto/requests/run-backtest.dto';
import { BacktestService } from '../domain/services/backtest.service';

@ApiTags('backtest')
@Controller('backtest')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post('run')
  async run(@Body() dto: RunBacktestDto) {
    return this.backtestService.enqueueRun(dto);
  }

  @Get('runs')
  async findAll() {
    return this.backtestService.findAllRuns();
  }

  @Get('runs/:runId')
  async findOne(@Param('runId') runId: string) {
    return this.backtestService.findRunById(runId);
  }
}
