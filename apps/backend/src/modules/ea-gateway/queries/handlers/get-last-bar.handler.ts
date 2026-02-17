import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetLastBarQuery } from '../impl/get-last-bar.query';
import { BarM15Repository } from '../../domain/repositories/bar-m15.repository';

export interface LastBarResult {
  symbol: string;
  timeOpen: string | null; // ISO string, null if no bars exist yet
}

@QueryHandler(GetLastBarQuery)
export class GetLastBarHandler implements IQueryHandler<GetLastBarQuery> {
  constructor(private readonly barM15Repository: BarM15Repository) {}

  async execute(query: GetLastBarQuery): Promise<LastBarResult> {
    const row = await this.barM15Repository.findLatest(query.symbol);
    return {
      symbol: query.symbol,
      timeOpen: row ? row.timeOpen.toISOString() : null,
    };
  }
}
