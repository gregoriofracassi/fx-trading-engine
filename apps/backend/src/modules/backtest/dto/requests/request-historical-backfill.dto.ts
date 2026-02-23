import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestHistoricalBackfillDto {
  @ApiProperty({ example: 'EURUSD' })
  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @ApiProperty({ example: 17520, description: 'Number of M15 bars to backfill (max 50000)' })
  @IsNumber()
  @Min(1)
  @Max(50000)
  barsCount!: number;
}
