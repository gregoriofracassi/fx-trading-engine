import { Injectable } from '@nestjs/common';

/**
 * SimulatedFillService — simulates MT5 order execution during a backtest replay.
 *
 * Responsibilities:
 * - Given a proposed trade plan (entry, SL, TP) and subsequent candles,
 *   determine whether the order would have been filled, and at what price
 * - Simulate fill at the open price of the next bar after the signal candle
 * - Track whether SL or TP was hit in subsequent bars
 * - Return simulated outcome: FILLED | CANCELLED | EXPIRED
 *
 * Rules:
 * - Fill price = next bar's open (standard market simulation, no slippage model yet)
 * - If price reaches RR 1:2 before fill → order is cancelled (per strategy rules)
 * - If order not filled by 16:30 → cancel (per session end rules)
 * - No real positions are created. No commands are sent to the EA.
 *
 * TODO (Milestone 7+): Implement simulation logic once StrategyModule is in place.
 */
@Injectable()
export class SimulatedFillService {}
