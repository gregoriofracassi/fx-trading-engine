import { S1DetectorService } from './s1-detector.service';
import { BarM15, AsiaRange } from '@prisma/client';
import { SetupType, SignalReasonCode } from '../types';

describe('S1DetectorService', () => {
  let service: S1DetectorService;

  beforeEach(() => {
    service = new S1DetectorService();
  });

  // ─── Helper Functions ────────────────────────────────────────────────────

  const createBar = (params: {
    symbol: string;
    timeOpen: Date;
    open: number;
    high: number;
    low: number;
    close: number;
  }): BarM15 => ({
    id: 'mock-id',
    symbol: params.symbol,
    timeOpen: params.timeOpen,
    timeClose: new Date(params.timeOpen.getTime() + 15 * 60 * 1000),
    open: params.open,
    high: params.high,
    low: params.low,
    close: params.close,
    tickVolume: 1000,
    spreadPoints: 10,
    source: 'test',
    createdAt: new Date(),
  });

  const createAsiaRange = (params: {
    high: number;
    low: number;
    finalized: boolean;
  }): AsiaRange => ({
    id: 'mock-asia-range',
    date: '2026-02-20',
    symbol: 'EURUSD',
    high: params.high,
    low: params.low,
    finalized: params.finalized,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // ─── Valid S1 Short Signal ────────────────────────────────────────────────

  describe('Valid S1 Short - Clear Example', () => {
    it('should detect valid S1 short when engulf body is fully below Asia Low', async () => {
      // Clear scenario:
      // Asia Range: 1.0800 (high) - 1.0700 (low)
      //
      // Push candle (bullish):
      //   Open: 1.0750, High: 1.0820, Low: 1.0745, Close: 1.0780
      //   Body: 1.0750 to 1.0780 (bullish)
      //   Breaks above Asia High (1.0820 > 1.0800)
      //
      // Engulf candle (bearish):
      //   Open: 1.0680, High: 1.0685, Low: 1.0660, Close: 1.0665
      //   Body: 1.0680 (high) to 1.0665 (low) - fully below Asia Low 1.0700
      //
      // Metrics:
      // - Acceptance: 1.0700 - 1.0680 = 2.0 pips ✓
      // - Engulfing: min(push.open, push.close) - engulf.close = min(1.0750, 1.0780) - 1.0665 = 1.0750 - 1.0665 = 8.5 pips ✓
      // - Liquidity: |push.high - engulf.high| = |1.0820 - 1.0685| = 13.5 pips (> 0.5, no liquidity) ✓
      // - Opposite Imb: push.high - asiaHigh = 1.0820 - 1.0800 = 2.0 pips (≥ 1.0, INVALID condition)
      // - Main Imb: asiaLow - engulf.low = 1.0700 - 1.0660 = 4.0 pips
      // - Dominance: 4.0 > 2.0 = TRUE ✓ (overrides opposite imbalance invalidation)
      //
      // Result: VALID S1 SHORT

      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.074,
          high: 1.075,
          low: 1.0735,
          close: 1.0745,
        }),

        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.075,
          high: 1.082,
          low: 1.0745,
          close: 1.078,
        }),

        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.068,
          high: 1.0685,
          low: 1.066,
          close: 1.0665,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.valid).toBe(true);
      expect(result!.setupType).toBe(SetupType.S1_SHORT);
      expect(result!.reasonCodes).toEqual([]);

      // Verify calculated metrics (in pips, not price distance!)
      // Acceptance: 1.0700 - 1.0680 = 0.0020 = 20 pips (not 2.0!)
      expect(result!.metrics.acceptance).toBeCloseTo(20.0, 0);
      expect(result!.metrics.engulfing).toBeCloseTo(85.0, 0);
      expect(result!.metrics.liquidity).toBeCloseTo(135.0, 0);
      expect(result!.metrics.oppositeImb).toBeCloseTo(20.0, 0);
      expect(result!.metrics.mainImb).toBeCloseTo(40.0, 0);

      // Verify candles identified
      expect(result!.pushCandle).toEqual(bars[1]);
      expect(result!.engulfCandle).toEqual(bars[2]);
    });
  });

  // ─── Invalid S1 Short Scenarios ────────────────────────────────────────────

  describe('Invalid S1 Short - Insufficient Acceptance', () => {
    it('should invalidate S1 short when acceptance < 0.6 pips', async () => {
      // Engulf body is only 0.4 pips below Asia Low (insufficient)
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.075,
          high: 1.076,
          low: 1.0745,
          close: 1.0755,
        }),

        // Push candle (bullish) - breaks above Asia High with high at 1.0850
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.0755,
          high: 1.085,
          low: 1.075,
          close: 1.0765,
        }),

        // Engulf (bearish) with body high at 1.06996 (only 0.4 pips below Asia Low 1.0700)
        // Acceptance = 1.0700 - 1.06996 = 0.00004 = 0.4 pips < 0.6 pips ✓
        // Body high = max(open, close) = max(1.0696, 1.06996) = 1.06996
        // Also need good engulfing and no liquidity to isolate acceptance issue
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.0696,
          high: 1.07,
          low: 1.068,
          close: 1.06996,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.valid).toBe(false);
      expect(result!.reasonCodes).toContain(SignalReasonCode.ACCEPTANCE_INSUFFICIENT);
    });
  });

  describe('Invalid S1 Short - Insufficient Engulfing', () => {
    it('should invalidate S1 short when engulfing < 0.6 pips', async () => {
      // Engulf candle barely moves below push candle (poor engulfing)
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.075,
          high: 1.076,
          low: 1.0745,
          close: 1.0755,
        }),

        // Push candle (bullish) with body low at 1.0690
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.069,
          high: 1.082,
          low: 1.0685,
          close: 1.0695,
        }),

        // Engulf close at 1.06896 (engulfing = 1.0690 - 1.06896 = 0.00004 = 0.4 pips < 0.6)
        // Body high = max(1.0660, 1.06896) = 1.06896 < 1.0700 ✓ (acceptance OK)
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.066,
          high: 1.075,
          low: 1.065,
          close: 1.06896,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.valid).toBe(false);
      expect(result!.reasonCodes).toContain(SignalReasonCode.ENGULFING_INSUFFICIENT);
    });
  });

  describe('Invalid S1 Short - Liquidity Present', () => {
    it('should invalidate S1 short when liquidity gap ≤ 0.5 pips', async () => {
      // Engulf high matches push high (liquidity taken)
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.075,
          high: 1.076,
          low: 1.0745,
          close: 1.0755,
        }),

        // Push high at 1.0820
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.0755,
          high: 1.082,
          low: 1.075,
          close: 1.0765,
        }),

        // Engulf high at 1.0820 (liquidity = 0 pips, ≤ 0.5)
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.069,
          high: 1.082,
          low: 1.067,
          close: 1.0675,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.valid).toBe(false);
      expect(result!.reasonCodes).toContain(SignalReasonCode.LIQUIDITY_PRESENT);
    });
  });

  describe('Invalid S1 Short - Opposite Imbalance Without Dominance', () => {
    it('should invalidate S1 short when opposite imbalance exists without dominance or annulment', async () => {
      // Push breaks above Asia High significantly, but main imbalance is weaker
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.075,
          high: 1.076,
          low: 1.0745,
          close: 1.0755,
        }),

        // Push high at 1.0830 (opposite imb = 1.0830 - 1.0800 = 30 pips)
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.0755,
          high: 1.083,
          low: 1.075,
          close: 1.0765,
        }),

        // Engulf low at 1.0690 (main imb = 1.0700 - 1.0690 = 10 pips, less than opposite imb 30 pips)
        // Engulf body high must be below Asia Low (1.0700), so open/close must be < 1.0700
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.0695,
          high: 1.08,
          low: 1.069,
          close: 1.0692,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.valid).toBe(false);
      expect(result!.reasonCodes).toContain(SignalReasonCode.OPPOSITE_IMBALANCE_VALID);
    });
  });

  // ─── Valid S1 Long Signal ────────────────────────────────────────────────

  describe('Valid S1 Long - Clear Example', () => {
    it('should detect valid S1 long when engulf body is fully above Asia High', async () => {
      // Asia Range: 1.0800 (high) - 1.0700 (low)
      //
      // Push candle (bearish):
      //   Open: 1.0750, High: 1.0755, Low: 1.0680, Close: 1.0685
      //   Breaks below Asia Low
      //
      // Engulf candle (bullish):
      //   Open: 1.0820, High: 1.0840, Low: 1.0815, Close: 1.0835
      //   Body: 1.0820 (low) to 1.0835 (high) - fully above Asia High 1.0800
      //
      // Result: VALID S1 LONG

      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.076,
          high: 1.0765,
          low: 1.0755,
          close: 1.0758,
        }),

        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.075,
          high: 1.0755,
          low: 1.068,
          close: 1.0685,
        }),

        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.082,
          high: 1.084,
          low: 1.0815,
          close: 1.0835,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.valid).toBe(true);
      expect(result!.setupType).toBe(SetupType.S1_LONG);
      expect(result!.reasonCodes).toEqual([]);

      // Verify metrics (acceptance, engulfing, etc.)
      expect(result!.metrics.acceptance).toBeGreaterThanOrEqual(0.6);
      expect(result!.metrics.engulfing).toBeGreaterThanOrEqual(0.6);
      expect(result!.metrics.liquidity).toBeGreaterThan(0.5);
    });
  });

  // ─── No Pattern Detected ────────────────────────────────────────────────

  describe('No S1 Pattern', () => {
    it('should return null when engulf candle does not break Asia Range', async () => {
      // Both candles stay within Asia Range
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 1.075,
          high: 1.076,
          low: 1.0745,
          close: 1.0755,
        }),
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 1.0755,
          high: 1.0765,
          low: 1.075,
          close: 1.076,
        }),
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 1.076,
          high: 1.077,
          low: 1.0755,
          close: 1.0765,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).toBeNull();
    });
  });

  // ─── Edge Cases & Validation ────────────────────────────────────────────

  describe('JPY Pairs - Different Pip Size', () => {
    it('should calculate pips correctly for JPY pairs (0.01 pip size)', async () => {
      // JPY pair: USDJPY, pip size = 0.01 (not 0.0001)
      const asiaRange: AsiaRange = {
        id: 'jpy-range',
        date: '2026-02-20',
        symbol: 'USDJPY',
        high: 150.5,
        low: 150.0,
        finalized: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const bars: BarM15[] = [
        createBar({
          symbol: 'USDJPY',
          timeOpen: new Date('2026-02-20T10:00:00Z'),
          open: 150.25,
          high: 150.3,
          low: 150.2,
          close: 150.28,
        }),

        // Push candle (bullish)
        createBar({
          symbol: 'USDJPY',
          timeOpen: new Date('2026-02-20T10:15:00Z'),
          open: 150.28,
          high: 150.65,
          low: 150.25,
          close: 150.35,
        }),

        // Engulf candle (bearish) - body high at 149.90
        // Acceptance = (150.00 - 149.90) / 0.01 = 0.10 / 0.01 = 10 pips
        createBar({
          symbol: 'USDJPY',
          timeOpen: new Date('2026-02-20T10:30:00Z'),
          open: 149.9,
          high: 149.95,
          low: 149.7,
          close: 149.75,
        }),
      ];

      const result = await service.detectS1('USDJPY', bars, asiaRange);

      expect(result).not.toBeNull();
      expect(result!.setupType).toBe(SetupType.S1_SHORT);
      // Acceptance = (150.00 - 149.90) / 0.01 = 10 pips
      expect(result!.metrics.acceptance).toBeCloseTo(10.0, 0);
    });
  });

  describe('Validation - Invalid Bar Data', () => {
    it('should throw InvalidBarDataException when bar has high < low', async () => {
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const invalidBar = createBar({
        symbol: 'EURUSD',
        timeOpen: new Date(),
        open: 1.075,
        high: 1.074, // High < Low (invalid!)
        low: 1.076,
        close: 1.0755,
      });

      const bars = [invalidBar];

      await expect(service.detectS1('EURUSD', bars, asiaRange)).rejects.toThrow('Invalid bar data');
    });
  });

  describe('Validation - Invalid Asia Range', () => {
    it('should throw InvalidAsiaRangeException when Asia Range has high < low', async () => {
      const invalidRange: AsiaRange = {
        id: 'invalid',
        date: '2026-02-20',
        symbol: 'EURUSD',
        high: 1.07, // High < Low (invalid!)
        low: 1.08,
        finalized: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date(),
          open: 1.075,
          high: 1.076,
          low: 1.074,
          close: 1.0755,
        }),
      ];

      await expect(service.detectS1('EURUSD', bars, invalidRange)).rejects.toThrow(
        'Invalid AsiaRange',
      );
    });
  });

  describe('Insufficient Bars', () => {
    it('should return null when fewer than 2 bars provided', async () => {
      const asiaRange = createAsiaRange({ high: 1.08, low: 1.07, finalized: true });

      const bars: BarM15[] = [
        createBar({
          symbol: 'EURUSD',
          timeOpen: new Date(),
          open: 1.075,
          high: 1.076,
          low: 1.074,
          close: 1.0755,
        }),
      ];

      const result = await service.detectS1('EURUSD', bars, asiaRange);

      expect(result).toBeNull();
    });
  });
});
