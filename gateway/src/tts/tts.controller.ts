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

  @Get('jobs/:id')
  @HttpCode(200)
  status(@Param('id') id: string) {
    return this.tts.status(id);
  }
}
