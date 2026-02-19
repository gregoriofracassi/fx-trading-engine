import { Injectable } from '@nestjs/common';
import { Signal } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';

export interface CreateSignalInput {
  symbol: string;
  timestamp: Date;
  dateRome: string;
  setupType: string;
  valid: boolean;
  acceptance?: number | null;
  engulfing?: number | null;
  liquidity?: number | null;
  oppositeImb?: number | null;
  mainImb?: number | null;
  reasonCodes: string[];
  asiaRangeId?: string;
  asiaHigh: number;
  asiaLow: number;
  pushCandleTime?: Date;
  engulfCandleTime?: Date;
}

@Injectable()
export class SignalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSignalInput): Promise<void> {
    await this.prisma.signal.create({
      data: input,
    });
  }

  async findByDateAndSymbol(date: string, symbol: string): Promise<Signal[]> {
    return this.prisma.signal.findMany({
      where: { dateRome: date, symbol },
      orderBy: { timestamp: 'asc' },
    });
  }

  async findValidSignals(symbol: string, fromDate: string, toDate: string): Promise<Signal[]> {
    return this.prisma.signal.findMany({
      where: {
        symbol,
        dateRome: { gte: fromDate, lte: toDate },
        valid: true,
      },
      orderBy: { timestamp: 'asc' },
    });
  }

  async findRecentSignals(symbol: string, limit: number): Promise<Signal[]> {
    return this.prisma.signal.findMany({
      where: { symbol },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}
