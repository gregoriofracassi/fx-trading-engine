import { Injectable } from '@nestjs/common';
import { RunBacktestDto } from '../../dto/requests/run-backtest.dto';

/**
 * BacktestService — orchestrates backtest run lifecycle.
 *
 * Responsibilities:
 * - Enqueue a new backtest run as a BullMQ background job (returns runId immediately)
 * - Query past backtest runs and their results
 *
 * NOTE: The actual replay logic (cursor walk, strategy evaluation, simulated fills)
 * lives in BacktestProcessor once the BullMQ queue is wired in.
 * This service is the public-facing API layer for the module.
 *
 * TODO (Milestone 7+): Wire BullMQ queue and implement enqueueRun fully.
 */
@Injectable()
export class BacktestService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async enqueueRun(_dto: RunBacktestDto): Promise<{ runId: string; status: string }> {
    // TODO: generate runId, enqueue BullMQ job, persist BacktestRun with status=QUEUED
    throw new Error('Not implemented yet');
  }

  async findAllRuns(): Promise<unknown[]> {
    // TODO: query BacktestRun table, return summary list
    throw new Error('Not implemented yet');
  }

  async findRunById(_runId: string): Promise<unknown> {
    // TODO: query BacktestRun + BacktestSignal for the given runId
    throw new Error('Not implemented yet');
  }
}
