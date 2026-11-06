import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  Matches,
  ValidateNested,
} from 'class-validator';
import { HASH_RE, MAX_BATCH, MAX_STATUS_IDS } from '../common/constants';
import { CreateTtsDto } from './create-tts.dto';

export class CreateTtsBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => CreateTtsDto)
  items!: CreateTtsDto[];
}

export class JobStatusBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STATUS_IDS)
  @Matches(HASH_RE, { each: true })
  ids!: string[];
}
