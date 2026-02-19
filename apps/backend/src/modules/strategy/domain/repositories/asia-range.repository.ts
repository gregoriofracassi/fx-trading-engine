import { Injectable } from '@nestjs/common';
import { AsiaRange } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';

export interface CreateAsiaRangeInput {
  date: string;
  symbol: string;
  high: number;
  low: number;
}

export interface UpdateAsiaRangeInput {
  high: number;
  low: number;
}

@Injectable()
export class AsiaRangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByDateAndSymbol(date: string, symbol: string): Promise<AsiaRange | null> {
    return this.prisma.asiaRange.findUnique({
      where: { date_symbol: { date, symbol } },
    });
  }

  async create(input: CreateAsiaRangeInput): Promise<void> {
    await this.prisma.asiaRange.create({
      data: { ...input, finalized: false },
    });
  }

  async update(date: string, symbol: string, input: UpdateAsiaRangeInput): Promise<void> {
    await this.prisma.asiaRange.update({
      where: { date_symbol: { date, symbol } },
      data: input,
    });
  }

  async finalize(date: string, symbol: string): Promise<void> {
    await this.prisma.asiaRange.update({
      where: { date_symbol: { date, symbol } },
      data: { finalized: true },
    });
  }

  /**
   * Find all AsiaRanges for a symbol.
   * Returns ranges ordered by date (oldest first).
   * Used by replay commands to fetch all ranges upfront (optimization).
   */
  async findAllBySymbol(symbol: string): Promise<AsiaRange[]> {
    return this.prisma.asiaRange.findMany({
      where: { symbol },
      orderBy: { date: 'asc' },
    });
  }
}
