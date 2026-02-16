import { Module } from '@nestjs/common';
import { BacktestController } from './controllers/backtest.controller';
import { BacktestRunRepository } from './domain/repositories/backtest-run.repository';
import { BacktestService } from './domain/services/backtest.service';
import { HistoricalDataService } from './domain/services/historical-data.service';
import { SimulatedFillService } from './domain/services/simulated-fill.service';
import { SimulatedStateService } from './domain/services/simulated-state.service';
import { DatabaseModule } from '../../database/database.module';

const Services = [
  BacktestService,
  HistoricalDataService,
  SimulatedFillService,
  SimulatedStateService,
];

@Module({
  imports: [DatabaseModule],
  controllers: [BacktestController],
  providers: [...Services, BacktestRunRepository],
  exports: [],
})
export class BacktestModule {}
