import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsNumber } from 'class-validator';

export class EaEventDto {
  @ApiProperty({ example: 'HEARTBEAT' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ example: 'FTMO_01' })
  @IsString()
  @IsNotEmpty()
  terminalId!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  seq?: number;

  @ApiPropertyOptional({ example: '2026.02.17 15:00:00' })
  @IsOptional()
  @IsString()
  sentAt?: string; // accepts any string format (MT5 sends non-ISO dates)

  // ─── BAR_M15_CLOSED fields (all optional — heartbeat ignores these) ───────────

  @ApiPropertyOptional({ example: 'EURUSD' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional({ example: '2026.02.17 15:00:00' })
  @IsOptional()
  @IsString()
  timeOpen?: string;

  @ApiPropertyOptional({ example: '2026.02.17 15:15:00' })
  @IsOptional()
  @IsString()
  timeClose?: string;

  @ApiPropertyOptional({ example: 1.083 })
  @IsOptional()
  @IsNumber()
  o?: number; // open

  @ApiPropertyOptional({ example: 1.084 })
  @IsOptional()
  @IsNumber()
  h?: number; // high

  @ApiPropertyOptional({ example: 1.082 })
  @IsOptional()
  @IsNumber()
  l?: number; // low

  @ApiPropertyOptional({ example: 1.0835 })
  @IsOptional()
  @IsNumber()
  c?: number; // close

  @ApiPropertyOptional({ example: 1234 })
  @IsOptional()
  @IsInt()
  tickVolume?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  spreadPoints?: number;
}
