import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for replay-s1-signals admin endpoint.
 * Triggers retroactive S1 signal detection from historical bars.
 */
export class ReplayS1SignalsDto {
  @ApiProperty({
    description: 'Symbol to replay S1 signals for',
    example: 'EURUSD',
  })
  @IsString()
  @IsNotEmpty()
  symbol!: string;
}
