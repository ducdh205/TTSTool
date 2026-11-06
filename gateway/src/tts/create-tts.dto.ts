import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AUDIO_FORMATS,
  MAX_SPEED,
  MAX_TEXT_LEN,
  MIN_SPEED,
  REGION_IDS,
  type AudioFormat,
  type RegionId,
} from '../common/constants';

export class CreateTtsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TEXT_LEN)
  @Matches(/\S/, { message: 'text không được để trống' })
  text!: string;

  @IsIn(REGION_IDS)
  region!: RegionId;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  voice!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(MIN_SPEED)
  @Max(MAX_SPEED)
  speed?: number;

  @IsOptional()
  @IsIn(AUDIO_FORMATS)
  format?: AudioFormat;
}
