import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CreateTtsBatchDto, JobStatusBatchDto } from './batch.dto';
import { CreateTtsDto } from './create-tts.dto';
import { TtsService } from './tts.service';

@Controller('tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  /** 200 when served from cache, 202 when queued/processing. */
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Body() dto: CreateTtsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const view = await this.tts.submit(dto);
    res.status(view.status === 'completed' ? 200 : 202);
    return view;
  }

  /** Always 200; per-item failures are reported as { status: 'failed', error }. */
  @Post('batch')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  batch(@Body() dto: CreateTtsBatchDto) {
    return this.tts.submitMany(dto.items);
  }

  @Post('jobs/status')
  @HttpCode(200)
  statusBatch(@Body() dto: JobStatusBatchDto) {
    return this.tts.statusMany(dto.ids);
  }

  @Get('jobs/:id')
  @HttpCode(200)
  status(@Param('id') id: string) {
    return this.tts.status(id);
  }
}
