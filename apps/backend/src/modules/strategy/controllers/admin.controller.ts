import { Controller, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BarM15Repository } from '../../ea-gateway/domain/repositories/bar-m15.repository';
import { AsiaRangeService } from '../domain/services/asia-range.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly asiaRangeService: AsiaRangeService,
  ) {}

  @Post('replay-asia-range')
  @ApiOperation({
    summary: 'Populate AsiaRange from existing BarM15 rows for a symbol',
  })
  @ApiQuery({ name: 'symbol', example: 'EURUSD' })
  async replayAsiaRange(@Query('symbol') symbol: string): Promise<{ processed: number }> {
    const bars = await this.barM15Repository.findAllBySymbol(symbol);

    for (const bar of bars) {
      await this.asiaRangeService.processBar(bar.symbol, bar.timeOpen, bar.high, bar.low);
    }

    return { processed: bars.length };
  }
}
