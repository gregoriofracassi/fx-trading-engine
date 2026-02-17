import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';

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

  @ApiPropertyOptional({ example: '2026-02-13T10:00:00Z' })
  @IsOptional()
  @IsString()
  sentAt?: string; // accepts any string format (MT5 sends non-ISO dates)
}
