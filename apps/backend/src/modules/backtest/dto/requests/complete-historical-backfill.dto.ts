import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteHistoricalBackfillDto {
  @ApiProperty({ example: 'EURUSD' })
  @IsString()
  @IsNotEmpty()
  symbol!: string;
}
