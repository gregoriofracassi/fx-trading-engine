import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsDate,
  IsNumber,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ParseMT5Date } from '../../../../common/decorators/parse-mt5-date.decorator';

export class HistoricalBarDto {
  @ApiProperty({
    example: '2025.06.09 05:30:00',
    description: 'MT5-format timestamp, parsed to Date',
  })
  @ParseMT5Date()
  @IsDate()
  timeOpen!: Date;

  @ApiProperty({
    example: '2025.06.09 05:45:00',
    description: 'MT5-format timestamp, parsed to Date',
  })
  @ParseMT5Date()
  @IsDate()
  timeClose!: Date;

  @ApiProperty({ example: 1.085 })
  @IsNumber()
  open!: number;

  @ApiProperty({ example: 1.0865 })
  @IsNumber()
  high!: number;

  @ApiProperty({ example: 1.0845 })
  @IsNumber()
  low!: number;

  @ApiProperty({ example: 1.086 })
  @IsNumber()
  close!: number;

  @ApiProperty({ example: 1250 })
  @IsInt()
  @Min(0)
  tickVolume!: number;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(0)
  spreadPoints!: number;
}

export class UploadHistoricalBarsDto {
  @ApiProperty({ example: 'EURUSD' })
  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @ApiProperty({ example: 1, description: 'Current chunk number (1-indexed)' })
  @IsInt()
  @Min(1)
  chunkNumber!: number;

  @ApiProperty({ example: 36, description: 'Total number of chunks expected' })
  @IsInt()
  @Min(1)
  totalChunks!: number;

  @ApiProperty({ type: [HistoricalBarDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoricalBarDto)
  bars!: HistoricalBarDto[];
}
