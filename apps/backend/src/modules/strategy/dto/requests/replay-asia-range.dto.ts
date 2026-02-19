import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for replay-asia-range admin endpoint.
 * Triggers retroactive Asia Range calculation from historical bars.
 */
export class ReplayAsiaRangeDto {
  @ApiProperty({
    description: 'Symbol to replay Asia Range for',
    example: 'EURUSD',
  })
  @IsString()
  @IsNotEmpty()
  symbol!: string;
}
