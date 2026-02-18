import { Injectable, Logger } from '@nestjs/common';
import { AsiaRange } from '@prisma/client';
import { AsiaRangeRepository } from '../repositories/asia-range.repository';

const ROME_TZ = 'Europe/Rome';

// ─── Strategy toggles ────────────────────────────────────────────────────────
// Set to false to include 23:xx Rome candles in the Asia Range calculation.
const IGNORE_23H_CANDLES = true;

interface RomeTime {
  dateStr: string; // "YYYY-MM-DD"
  hour: number;
  minute: number;
}

// ─── Pure helpers (no side effects) ──────────────────────────────────────────

function toRomeTime(utcDate: Date): RomeTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const get = (type: string): string => parts.find((p) => p.type === type)!.value;
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

function isIgnoredCandle(hour: number): boolean {
  // Strategy spec: bars between 23:00 and 00:00 Rome are excluded.
  // Toggle with IGNORE_23H_CANDLES above.
  return IGNORE_23H_CANDLES && hour === 23;
}

function isAfterAsiaStart(hour: number): boolean {
  return hour >= 1;
}

function isBeforeAsiaEnd(hour: number, minute: number): boolean {
  // Last bar of session opens at 08:00 and closes at 08:15
  return hour < 8 || (hour === 8 && minute === 0);
}

function isInAsiaSession(hour: number, minute: number): boolean {
  // Asia session window: [01:00, 08:15) Rome.
  return isAfterAsiaStart(hour) && isBeforeAsiaEnd(hour, minute);
}

function isFinalizingBar(hour: number, minute: number): boolean {
  return hour === 8 && minute === 0;
}

function computeUpdatedRange(
  existing: AsiaRange,
  high: number,
  low: number,
): { high: number; low: number } {
  return {
    high: Math.max(existing.high, high),
    low: Math.min(existing.low, low),
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AsiaRangeService {
  private readonly logger = new Logger(AsiaRangeService.name);

  constructor(private readonly asiaRangeRepository: AsiaRangeRepository) {}

  async processBar(symbol: string, timeOpen: Date, high: number, low: number): Promise<void> {
    const rome = toRomeTime(timeOpen);

    if (isIgnoredCandle(rome.hour)) return;
    if (!isInAsiaSession(rome.hour, rome.minute)) return;

    const existing = await this.asiaRangeRepository.findByDateAndSymbol(rome.dateStr, symbol);
    if (existing?.finalized) return;

    await this.upsertRange(rome.dateStr, symbol, high, low, existing);
    await this.maybeFinalizeRange(rome.dateStr, symbol, rome.hour, rome.minute);
  }

  private async maybeFinalizeRange(
    dateStr: string,
    symbol: string,
    hour: number,
    minute: number,
  ): Promise<void> {
    if (!isFinalizingBar(hour, minute)) return;
    await this.asiaRangeRepository.finalize(dateStr, symbol);
    this.logger.log(`AsiaRange FINALIZED | ${symbol} | date=${dateStr}`);
  }

  private async upsertRange(
    dateStr: string,
    symbol: string,
    high: number,
    low: number,
    existing: AsiaRange | null,
  ): Promise<void> {
    if (!existing) {
      await this.asiaRangeRepository.create({ date: dateStr, symbol, high, low });
      this.logger.log(`AsiaRange created | ${symbol} | date=${dateStr} | high=${high} low=${low}`);
      return;
    }

    const updated = computeUpdatedRange(existing, high, low);
    await this.asiaRangeRepository.update(dateStr, symbol, updated);
    this.logger.log(
      `AsiaRange updated | ${symbol} | date=${dateStr} | high=${updated.high} low=${updated.low}`,
    );
  }
}
