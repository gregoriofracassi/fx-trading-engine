import { Injectable } from '@nestjs/common';
import { BarM15, AsiaRange } from '@prisma/client';
import { SignalReasonCode, SetupType } from '../types';
import { toPips } from '../utils/forex.utils';
import { validateBars, validateAsiaRange } from '../utils/validation.utils';

// ─── Constants ───────────────────────────────────────────────────────────────

const ENGULFING_MIN = 0.6; // pips
const ACCEPTANCE_MIN = 0.6; // pips
const LIQUIDITY_MAX = 0.5; // pips
const IMBALANCE_MIN = 1.0; // pip

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SignalDetectionResult {
  valid: boolean;
  setupType: SetupType;
  metrics: {
    acceptance: number | null;
    engulfing: number | null;
    liquidity: number | null;
    oppositeImb: number | null;
    mainImb: number | null;
  };
  reasonCodes: SignalReasonCode[];
  pushCandle: BarM15 | null;
  engulfCandle: BarM15 | null;
}

interface PushEngulfPair {
  push: BarM15;
  engulf: BarM15;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class S1DetectorService {
  /**
   * Main entry point: detect S1 patterns (both short and long).
   * Returns null if no pattern detected, otherwise returns result with metrics.
   *
   * @throws {InvalidBarDataException} if any bar has invalid OHLC data
   * @throws {InvalidAsiaRangeException} if asiaRange is logically invalid
   */
  async detectS1(
    symbol: string,
    recentBars: BarM15[],
    asiaRange: AsiaRange,
  ): Promise<SignalDetectionResult | null> {
    // Validate inputs (throws if invalid)
    validateAsiaRange(asiaRange);
    validateBars(recentBars);

    if (recentBars.length < 2) {
      return null; // Need at least 2 bars (push + engulf)
    }

    // Try short first
    const shortResult = this.detectS1Short(symbol, recentBars, asiaRange);
    if (shortResult) return shortResult;

    // Try long
    const longResult = this.detectS1Long(symbol, recentBars, asiaRange);
    if (longResult) return longResult;

    return null;
  }

  // ─── Short Detection ─────────────────────────────────────────────────────

  private detectS1Short(
    symbol: string,
    recentBars: BarM15[],
    asiaRange: AsiaRange,
  ): SignalDetectionResult | null {
    const pair = this.identifyPushAndEngulfShort(recentBars, asiaRange.low);
    if (!pair) return null;

    const { push, engulf } = pair;

    // Calculate all metrics
    const acceptance = this.calculateAcceptanceShort(engulf, asiaRange.low, symbol);
    const engulfing = this.calculateEngulfing(push, engulf, symbol);
    const liquidity = this.calculateLiquidity(push, engulf, symbol);
    const oppositeImb = this.calculateOppositeImbalanceShort(push, asiaRange.high, symbol);
    const mainImb = this.calculateMainImbalanceShort(engulf, asiaRange.low, symbol);

    // Validate
    const reasonCodes = this.validateS1MetricsShort(
      acceptance,
      engulfing,
      liquidity,
      oppositeImb,
      mainImb,
      push,
      recentBars,
    );

    const valid = reasonCodes.length === 0;

    return {
      valid,
      setupType: SetupType.S1_SHORT,
      metrics: { acceptance, engulfing, liquidity, oppositeImb, mainImb },
      reasonCodes,
      pushCandle: push,
      engulfCandle: engulf,
    };
  }

  // ─── Long Detection ──────────────────────────────────────────────────────

  private detectS1Long(
    symbol: string,
    recentBars: BarM15[],
    asiaRange: AsiaRange,
  ): SignalDetectionResult | null {
    const pair = this.identifyPushAndEngulfLong(recentBars, asiaRange.high);
    if (!pair) return null;

    const { push, engulf } = pair;

    const acceptance = this.calculateAcceptanceLong(engulf, asiaRange.high, symbol);
    const engulfing = this.calculateEngulfingLong(push, engulf, symbol);
    const liquidity = this.calculateLiquidityLong(push, engulf, symbol);
    const oppositeImb = this.calculateOppositeImbalanceLong(push, asiaRange.low, symbol);
    const mainImb = this.calculateMainImbalanceLong(engulf, asiaRange.high, symbol);

    const reasonCodes = this.validateS1MetricsLong(
      acceptance,
      engulfing,
      liquidity,
      oppositeImb,
      mainImb,
      push,
      recentBars,
    );

    const valid = reasonCodes.length === 0;

    return {
      valid,
      setupType: SetupType.S1_LONG,
      metrics: { acceptance, engulfing, liquidity, oppositeImb, mainImb },
      reasonCodes,
      pushCandle: push,
      engulfCandle: engulf,
    };
  }

  // ─── Pattern Identification ──────────────────────────────────────────────

  private identifyPushAndEngulfShort(bars: BarM15[], asiaLow: number): PushEngulfPair | null {
    // Look for last 2 bars where:
    // - engulf (most recent) closes below Asia Low (acceptance)
    // - push (previous) brought price up
    const engulf = bars[bars.length - 1];
    const push = bars[bars.length - 2];

    const engulfBodyHigh = Math.max(engulf.open, engulf.close);
    if (engulfBodyHigh >= asiaLow) {
      return null; // Engulf didn't accept below Asia Low
    }

    // Push should have brought price higher (bullish or at least not strongly bearish)
    return { push, engulf };
  }

  private identifyPushAndEngulfLong(bars: BarM15[], asiaHigh: number): PushEngulfPair | null {
    const engulf = bars[bars.length - 1];
    const push = bars[bars.length - 2];

    const engulfBodyLow = Math.min(engulf.open, engulf.close);
    if (engulfBodyLow <= asiaHigh) {
      return null; // Engulf didn't accept above Asia High
    }

    return { push, engulf };
  }

  // ─── Metric Calculations (Short) ─────────────────────────────────────────

  private calculateAcceptanceShort(candle: BarM15, asiaLow: number, symbol: string): number {
    const bodyHigh = Math.max(candle.open, candle.close);
    return toPips(asiaLow - bodyHigh, symbol);
  }

  private calculateEngulfing(push: BarM15, engulf: BarM15, symbol: string): number {
    const pushBodyLow = Math.min(push.open, push.close);
    return toPips(pushBodyLow - engulf.close, symbol);
  }

  private calculateLiquidity(push: BarM15, engulf: BarM15, symbol: string): number {
    return toPips(Math.abs(push.high - engulf.high), symbol);
  }

  private calculateOppositeImbalanceShort(push: BarM15, asiaHigh: number, symbol: string): number {
    return toPips(push.high - asiaHigh, symbol);
  }

  private calculateMainImbalanceShort(candle: BarM15, asiaLow: number, symbol: string): number {
    return toPips(asiaLow - candle.low, symbol);
  }

  // ─── Metric Calculations (Long) ──────────────────────────────────────────

  private calculateAcceptanceLong(candle: BarM15, asiaHigh: number, symbol: string): number {
    const bodyLow = Math.min(candle.open, candle.close);
    return toPips(bodyLow - asiaHigh, symbol);
  }

  private calculateEngulfingLong(push: BarM15, engulf: BarM15, symbol: string): number {
    const pushBodyHigh = Math.max(push.open, push.close);
    return toPips(engulf.close - pushBodyHigh, symbol);
  }

  private calculateLiquidityLong(push: BarM15, engulf: BarM15, symbol: string): number {
    return toPips(Math.abs(push.low - engulf.low), symbol);
  }

  private calculateOppositeImbalanceLong(push: BarM15, asiaLow: number, symbol: string): number {
    return toPips(asiaLow - push.low, symbol);
  }

  private calculateMainImbalanceLong(candle: BarM15, asiaHigh: number, symbol: string): number {
    return toPips(candle.high - asiaHigh, symbol);
  }

  // ─── Validation Helpers ──────────────────────────────────────────────────

  private validateS1MetricsShort(
    acceptance: number,
    engulfing: number,
    liquidity: number,
    oppositeImb: number,
    mainImb: number,
    push: BarM15,
    recentBars: BarM15[],
  ): SignalReasonCode[] {
    const reasonCodes: SignalReasonCode[] = [];

    if (acceptance < ACCEPTANCE_MIN) {
      reasonCodes.push(SignalReasonCode.ACCEPTANCE_INSUFFICIENT);
    }
    if (engulfing < ENGULFING_MIN) {
      reasonCodes.push(SignalReasonCode.ENGULFING_INSUFFICIENT);
    }
    if (liquidity <= LIQUIDITY_MAX) {
      reasonCodes.push(SignalReasonCode.LIQUIDITY_PRESENT);
    }

    const oppImbalanceInvalid = this.checkOppositeImbalanceInvalidShort(
      oppositeImb,
      mainImb,
      push,
      recentBars,
    );
    if (oppImbalanceInvalid) {
      reasonCodes.push(SignalReasonCode.OPPOSITE_IMBALANCE_VALID);
    }

    return reasonCodes;
  }

  private validateS1MetricsLong(
    acceptance: number,
    engulfing: number,
    liquidity: number,
    oppositeImb: number,
    mainImb: number,
    push: BarM15,
    recentBars: BarM15[],
  ): SignalReasonCode[] {
    const reasonCodes: SignalReasonCode[] = [];

    if (acceptance < ACCEPTANCE_MIN) {
      reasonCodes.push(SignalReasonCode.ACCEPTANCE_INSUFFICIENT);
    }
    if (engulfing < ENGULFING_MIN) {
      reasonCodes.push(SignalReasonCode.ENGULFING_INSUFFICIENT);
    }
    if (liquidity <= LIQUIDITY_MAX) {
      reasonCodes.push(SignalReasonCode.LIQUIDITY_PRESENT);
    }

    const oppImbalanceInvalid = this.checkOppositeImbalanceInvalidLong(
      oppositeImb,
      mainImb,
      push,
      recentBars,
    );
    if (oppImbalanceInvalid) {
      reasonCodes.push(SignalReasonCode.OPPOSITE_IMBALANCE_VALID);
    }

    return reasonCodes;
  }

  private checkOppositeImbalanceInvalidShort(
    oppositeImb: number,
    mainImb: number,
    push: BarM15,
    recentBars: BarM15[],
  ): boolean {
    if (oppositeImb < IMBALANCE_MIN) return false;

    const hasDominance = this.checkDominance(mainImb, oppositeImb);
    const isAnnulled = this.checkOppositeAnnulledShort(push, recentBars);

    return !hasDominance && !isAnnulled;
  }

  private checkOppositeImbalanceInvalidLong(
    oppositeImb: number,
    mainImb: number,
    push: BarM15,
    recentBars: BarM15[],
  ): boolean {
    if (oppositeImb < IMBALANCE_MIN) return false;

    const hasDominance = this.checkDominance(mainImb, oppositeImb);
    const isAnnulled = this.checkOppositeAnnulledLong(push, recentBars);

    return !hasDominance && !isAnnulled;
  }

  private checkDominance(mainImb: number, oppImb: number): boolean {
    return mainImb > oppImb;
  }

  private checkOppositeAnnulledShort(push: BarM15, recentBars: BarM15[]): boolean {
    const pushIndex = recentBars.indexOf(push);
    const laterBars = recentBars.slice(pushIndex + 1);

    for (const bar of laterBars) {
      const liquidityGap = Math.abs(push.low - bar.low);
      const liquidityPips = toPips(liquidityGap, push.symbol);
      if (liquidityPips <= LIQUIDITY_MAX) {
        return true; // Liquidity at lows found → opposite annulled
      }
    }
    return false;
  }

  private checkOppositeAnnulledLong(push: BarM15, recentBars: BarM15[]): boolean {
    const pushIndex = recentBars.indexOf(push);
    const laterBars = recentBars.slice(pushIndex + 1);

    for (const bar of laterBars) {
      const liquidityGap = Math.abs(push.high - bar.high);
      const liquidityPips = toPips(liquidityGap, push.symbol);
      if (liquidityPips <= LIQUIDITY_MAX) {
        return true; // Liquidity at highs found → opposite annulled
      }
    }
    return false;
  }
}
