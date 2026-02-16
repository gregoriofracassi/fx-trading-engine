import { IsString, IsDateString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RunBacktestDto {
  @ApiProperty({ example: 'EURUSD', description: 'The forex symbol to backtest' })
  @IsString()
  symbol!: string;

  @ApiProperty({ example: '2025-01-01', description: 'Start date (inclusive), ISO 8601' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2025-07-01', description: 'End date (inclusive), ISO 8601' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional({
    description: 'Optional strategy parameter overrides for this run',
    example: { acceptanceMinPips: 0.7, engulfingMinPips: 0.6 },
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
