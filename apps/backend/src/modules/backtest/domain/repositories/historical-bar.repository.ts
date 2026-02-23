import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';

export interface UpsertHistoricalBarInput {
  symbol: string;
  timeOpen: Date;
  timeClose: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spreadPoints: number;
}

@Injectable()
export class HistoricalBarRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertHistoricalBarInput): Promise<void> {
    await this.prisma.barM15.upsert({
      where: {
        symbol_timeOpen: {
          symbol: input.symbol,
          timeOpen: input.timeOpen,
        },
      },
      create: {
        symbol: input.symbol,
        timeOpen: input.timeOpen,
        timeClose: input.timeClose,
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        tickVolume: input.tickVolume,
        spreadPoints: input.spreadPoints,
        source: 'HISTORICAL',
      },
      update: {
        timeClose: input.timeClose,
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        tickVolume: input.tickVolume,
        spreadPoints: input.spreadPoints,
      },
    });
  }
}
