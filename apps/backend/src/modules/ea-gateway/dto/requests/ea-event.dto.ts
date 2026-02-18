import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsDate,
  ValidateIf,
} from 'class-validator';
import { ParseMT5Date } from '../../../../common/decorators/parse-mt5-date.decorator';

const isBarEvent = (o: EaEventDto) => o.type === 'BAR_M15_CLOSED';

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

  @ApiPropertyOptional({
    example: '2026.02.17 15:00:00',
    description: 'MT5-format timestamp, parsed to Date',
  })
  @IsOptional()
  @ParseMT5Date()
  @IsDate()
  sentAt?: Date;

  // ─── BAR_M15_CLOSED fields ────────────────────────────────────────────────────
  // Required when type === 'BAR_M15_CLOSED', ignored otherwise.

  @ApiPropertyOptional({ example: 'EURUSD' })
  @ValidateIf(isBarEvent)
  @IsString()
  @IsNotEmpty()
  symbol?: string;

  @ApiPropertyOptional({
    example: '2026.02.17 15:00:00',
    description: 'MT5-format timestamp, parsed to Date',
  })
  @ValidateIf(isBarEvent)
  @ParseMT5Date()
  @IsDate()
  timeOpen?: Date;

  @ApiPropertyOptional({
    example: '2026.02.17 15:15:00',
    description: 'MT5-format timestamp, parsed to Date',
  })
  @ValidateIf(isBarEvent)
  @ParseMT5Date()
  @IsDate()
  timeClose?: Date;

  @ApiPropertyOptional({ example: 1.083 })
  @ValidateIf(isBarEvent)
  @IsNumber()
  open?: number;

  @ApiPropertyOptional({ example: 1.084 })
  @ValidateIf(isBarEvent)
  @IsNumber()
  high?: number;

  @ApiPropertyOptional({ example: 1.082 })
  @ValidateIf(isBarEvent)
  @IsNumber()
  low?: number;

  @ApiPropertyOptional({ example: 1.0835 })
  @ValidateIf(isBarEvent)
  @IsNumber()
  close?: number;

  @ApiPropertyOptional({ example: 1234 })
  @ValidateIf(isBarEvent)
  @IsInt()
  tickVolume?: number;

  @ApiPropertyOptional({ example: 12 })
  @ValidateIf(isBarEvent)
  @IsInt()
  spreadPoints?: number;
}
