import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { GetLastBarQuery } from '../impl/get-last-bar.query';
import { BarM15Repository } from '../../domain/repositories/bar-m15.repository';
import { BackfillStateService } from '../../../backtest/domain/services/backfill-state.service';

export interface LastBarResult {
  symbol: string;
  timeOpen: string | null; // ISO string, null if no bars exist yet
  historicalBackfill?: {
    requested: boolean;
    barsRequested: number;
    totalChunks: number;
  };
}

@QueryHandler(GetLastBarQuery)
export class GetLastBarHandler implements IQueryHandler<GetLastBarQuery> {
  private readonly logger = new Logger(GetLastBarHandler.name);

  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly backfillStateService: BackfillStateService,
  ) {}

  async execute(query: GetLastBarQuery): Promise<LastBarResult> {
    const row = await this.barM15Repository.findLatest(query.symbol);
    const backfillRequest = this.backfillStateService.getRequest(query.symbol);

    const result: LastBarResult = {
      symbol: query.symbol,
      timeOpen: row ? row.timeOpen.toISOString() : null,
    };

    if (backfillRequest) {
      this.logger.log(
        `[BACKFILL FLAG SENT] ${query.symbol} | bars=${backfillRequest.barsRequested} | chunks=${backfillRequest.totalChunks} | EA should detect on this request`,
      );
      result.historicalBackfill = {
        requested: true,
        barsRequested: backfillRequest.barsRequested,
        totalChunks: backfillRequest.totalChunks,
      };
    }

    return result;
  }
}
