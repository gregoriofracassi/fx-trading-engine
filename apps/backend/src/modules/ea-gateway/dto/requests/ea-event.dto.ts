import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsDateString } from 'class-validator';

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
  @IsDateString()
  sentAt?: string;
}
