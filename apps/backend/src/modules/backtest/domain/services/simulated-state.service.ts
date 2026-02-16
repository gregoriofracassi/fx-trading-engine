import { Injectable } from '@nestjs/common';

/**
 * SimulatedStateService — maintains isolated simulated account state for a backtest run.
 *
 * Responsibilities:
 * - Track open simulated positions and pending simulated orders per run
 * - Track simulated daily state (slCount, haltedForDay) per simulated trading day
 * - Apply the same risk rules as live (max 1 position per symbol, 3 SL cap, etc.)
 *   but against this isolated state — never touching live Position/Order/DailyState tables
 * - Reset daily counters when the replay cursor crosses midnight
 *
 * This is the backtest equivalent of the live DailyState + Position tables.
 * It is instantiated fresh for each backtest run and holds no persistent state.
 *
 * TODO (Milestone 7+): Implement once StrategyModule and RiskModule are in place.
 */
@Injectable()
export class SimulatedStateService {
  reset(): void {
    // TODO: clear all simulated positions, orders, and daily counters
  }
}
