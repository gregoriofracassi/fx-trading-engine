import { Injectable } from '@nestjs/common';

/**
 * HistoricalDataService — fetches and stores historical M15 candles for backtesting.
 *
 * Responsibilities:
 * - Check which candles are already present in BarM15 for a given symbol + date range
 * - Fetch missing candles from the configured external provider
 * - Upsert fetched candles into BarM15 with source = 'HISTORICAL'
 *
 * The external data provider is intentionally abstracted here.
 * Provider candidates (decision deferred):
 *   - FXCM REST API (closest to original strategy calibration data)
 *   - dukascopy-node (free, no account, actively maintained)
 *   - Own accumulated FTMO live data once 6+ months of BarM15 rows exist
 *
 * This service is called by BacktestProcessor before the replay loop starts.
 *
 * TODO (Milestone 7+): Implement provider integration once data source is decided.
 */
@Injectable()
export class HistoricalDataService {
  async ensureCandles(_symbol: string, _fromDate: Date, _toDate: Date): Promise<void> {
    // TODO:
    // 1. Query BarM15 for (symbol, timeOpen BETWEEN fromDate AND toDate)
    // 2. Identify gaps in the candle coverage
    // 3. Fetch missing candles from external provider
    // 4. Upsert into BarM15 with source = 'HISTORICAL'
    throw new Error('Not implemented yet');
  }
}
