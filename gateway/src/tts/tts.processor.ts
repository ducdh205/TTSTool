import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { TTS_QUEUE } from '../common/constants';
import { AudioCacheService } from '../cache/audio-cache.service';
import { appConfig, type AppConfig } from '../config/app.config';
import { TtsClientService, TtsServiceError } from '../tts-client/tts-client.service';
import type { TtsJobData, TtsJobResult } from './tts.types';

@Processor(TTS_QUEUE)
export class TtsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TtsProcessor.name);

  constructor(
    @Inject(appConfig.KEY) private readonly cfg: AppConfig,
    private readonly client: TtsClientService,
    private readonly cache: AudioCacheService,
  ) {
    super();
  }

  onModuleInit() {
    // CPU inference: keep this at 1 unless tts-service runs on a GPU.
    this.worker.concurrency = Math.max(1, this.cfg.queueConcurrency);
  }

  async process(job: Job<TtsJobData, TtsJobResult>): Promise<TtsJobResult> {
    const { hash, text, voice, speed, format } = job.data;
    const started = Date.now();
    await job.updateProgress(5);
    try {
      const { data, duration } = await this.client.synthesize({ text, voice, speed, format });
      await job.updateProgress(90);
      await this.cache.put(hash, format, data, duration);
      this.logger.log(`job ${hash.slice(0, 8)} done: ${text.length} chars -> ${duration}s audio in ${Date.now() - started}ms`);
      return { hash, ext: format, duration };
    } catch (e) {
      // 4xx from tts-service (bad voice, text too long...) will not succeed on retry.
      if (e instanceof TtsServiceError && e.isClientError) throw new UnrecoverableError(e.message);
      throw e;
    }
  }
}
