import { Injectable, Logger } from '@nestjs/common';
import { AsiaRange, BarM15 } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { S1DetectorService, SignalDetectionResult } from './s1-detector.service';
import { SignalRepository } from '../repositories/signal.repository';

/**
 * Shared service for S1 signal detection and persistence.
 * Used by both live event handlers and replay commands.
 */
@Injectable()
export class S1SignalService {
  private readonly logger = new Logger(S1SignalService.name);

  constructor(
    private readonly s1DetectorService: S1DetectorService,
    private readonly signalRepository: SignalRepository,
  ) {}

  /**
   * Detect S1 signal and save to database if found.
   * Returns the detection result or null if no signal detected.
   *
   * @throws {InvalidBarDataException} if bar data is corrupt
   * @throws {InvalidAsiaRangeException} if asia range is invalid
   */
  async detectAndSaveSignal(
    symbol: string,
    timestamp: Date,
    dateRome: string,
    recentBars: BarM15[],
    asiaRange: AsiaRange,
  ): Promise<SignalDetectionResult | null> {
    const result = await this.s1DetectorService.detectS1(symbol, recentBars, asiaRange);

    if (!result) {
      return null;
    }

    await this.saveSignalIfNotDuplicate(symbol, timestamp, dateRome, result, asiaRange);
    return result;
  }

  /**
   * Save signal to database, handling duplicates gracefully.
   */
  private async saveSignalIfNotDuplicate(
    symbol: string,
    timestamp: Date,
    dateRome: string,
    result: SignalDetectionResult,
    asiaRange: AsiaRange,
  ): Promise<void> {
    try {
      await this.persistSignal(symbol, timestamp, dateRome, result, asiaRange);
      this.logSignalDetection(symbol, dateRome, result);
    } catch (error) {
      this.handleSaveError(error);
    }
  }

  /**
   * Persist signal to database.
   */
  private async persistSignal(
    symbol: string,
    timestamp: Date,
    dateRome: string,
    result: SignalDetectionResult,
    asiaRange: AsiaRange,
  ): Promise<void> {
    await this.signalRepository.create({
      symbol,
      timestamp,
      dateRome,
      setupType: result.setupType,
      valid: result.valid,
      acceptance: result.metrics.acceptance,
      engulfing: result.metrics.engulfing,
      liquidity: result.metrics.liquidity,
      oppositeImb: result.metrics.oppositeImb,
      mainImb: result.metrics.mainImb,
      reasonCodes: result.reasonCodes,
      asiaRangeId: asiaRange.id,
      asiaHigh: asiaRange.high,
      asiaLow: asiaRange.low,
      pushCandleTime: result.pushCandle?.timeOpen,
      engulfCandleTime: result.engulfCandle?.timeOpen,
    });
  }

  /**
   * Log successful signal detection.
   */
  private logSignalDetection(
    symbol: string,
    dateRome: string,
    result: SignalDetectionResult,
  ): void {
    this.logger.log(
      `S1 Signal detected | ${symbol} | ${result.setupType} | valid=${result.valid} | ${dateRome}`,
    );
  }

  /**
   * Handle save errors, ignoring duplicates and re-throwing others.
   */
  private handleSaveError(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return; // Duplicate signal, skip silently
    }
    throw error;
  }
}
