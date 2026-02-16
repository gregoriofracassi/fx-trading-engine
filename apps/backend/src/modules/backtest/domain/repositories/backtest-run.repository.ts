import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';

/**
 * BacktestRunRepository — persistence layer for BacktestRun and BacktestSignal records.
 *
 * Responsibilities:
 * - Create a new BacktestRun record when a run is enqueued
 * - Update run status as it progresses (QUEUED → RUNNING → COMPLETED / FAILED)
 * - Save BacktestSignal records produced during the replay
 * - Query runs by ID or list all runs with summary stats
 *
 * TODO (Milestone 7+): Add BacktestRun and BacktestSignal models to schema.prisma,
 * then implement the methods below.
 */
@Injectable()
export class BacktestRunRepository {
  constructor(private readonly prisma: PrismaService) {}
}
