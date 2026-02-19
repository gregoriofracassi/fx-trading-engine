import { Injectable } from '@nestjs/common';
import { BarM15 } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';

export interface UpsertBarM15Input {
  symbol: string;
  timeOpen: Date;
  timeClose: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spreadPoints: number;
  source: string;
}

@Injectable()
export class BarM15Repository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertBarM15Input): Promise<void> {
    await this.prisma.barM15.upsert({
      where: {
        symbol_timeOpen: {
          symbol: input.symbol,
          timeOpen: input.timeOpen,
        },
      },
      create: { ...input },
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

  async findLatest(symbol: string): Promise<{ timeOpen: Date } | null> {
    const row = await this.prisma.barM15.findFirst({
      where: { symbol },
      orderBy: { timeOpen: 'desc' },
      select: { timeOpen: true },
    });
    return row ?? null;
  }

  async findAllBySymbol(symbol: string): Promise<
    {
      symbol: string;
      timeOpen: Date;
      timeClose: Date;
      open: number;
      high: number;
      low: number;
      close: number;
    }[]
  > {
    return this.prisma.barM15.findMany({
      where: { symbol },
      orderBy: { timeOpen: 'asc' },
      select: {
        symbol: true,
        timeOpen: true,
        timeClose: true,
        open: true,
        high: true,
        low: true,
        close: true,
      },
    });
  }

  /**
   * Find the most recent N bars before (and including) a given time.
   * Returns bars in chronological order (oldest first).
   * Used by S1DetectorService to analyze recent patterns.
   */
  async findRecentBars(symbol: string, beforeTime: Date, limit: number): Promise<BarM15[]> {
    const bars = await this.prisma.barM15.findMany({
      where: {
        symbol,
        timeClose: { lte: beforeTime },
      },
      orderBy: { timeClose: 'desc' },
      take: limit,
    });

    // Reverse to return chronological order (oldest first)
    return bars.reverse();
  }
}
