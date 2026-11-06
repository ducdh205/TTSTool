import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { HASH_RE, TTS_QUEUE } from '../common/constants';
import { cacheKey, normalizeText, roundSpeed } from '../cache/cache-key';
import {
  AudioCacheService,
  type CacheEntry,
} from '../cache/audio-cache.service';
import { appConfig, type AppConfig } from '../config/app.config';
import { VoicesService } from '../voices/voices.service';
import type { CreateTtsDto } from './create-tts.dto';
import type { JobView, TtsJobData, TtsJobResult } from './tts.types';

@Injectable()
export class TtsService {
  constructor(
    @InjectQueue(TTS_QUEUE)
    private readonly queue: Queue<TtsJobData, TtsJobResult>,
    @Inject(appConfig.KEY) private readonly cfg: AppConfig,
    private readonly cache: AudioCacheService,
    private readonly voices: VoicesService,
  ) {}

  async submit(dto: CreateTtsDto): Promise<JobView> {
    // SDK voice names are NFC; normalize once so validation, cache key and job agree.
    const voice = dto.voice.normalize('NFC');
    await this.voices.assertVoiceInRegion(voice, dto.region);

    const data: Omit<TtsJobData, 'hash'> = {
      text: normalizeText(dto.text),
      voice,
      speed: roundSpeed(dto.speed ?? 1),
      format: dto.format ?? 'mp3',
    };
    const hash = cacheKey({ modelTag: this.cfg.modelTag, ...data });

    const hit = await this.cache.get(hash);
    if (hit) return this.fromCache(hit);

    // jobId = hash: identical requests in flight collapse onto one job.
    // A finished/failed job with the same id would block re-adding, so drop it first.
    const existing = await this.queue.getJob(hash);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') await existing.remove();
    }
    await this.queue.add(
      'synthesize',
      { hash, ...data },
      {
        jobId: hash,
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 3600 },
      },
    );
    return this.status(hash);
  }

  async status(jobId: string): Promise<JobView> {
    if (!HASH_RE.test(jobId)) throw new NotFoundException('Job không tồn tại');
    const job = await this.queue.getJob(jobId);
    if (!job) {
      const hit = await this.cache.get(jobId);
      if (hit) return this.fromCache(hit);
      throw new NotFoundException('Job không tồn tại');
    }

    const state = await job.getState();
    switch (state) {
      case 'completed': {
        const r = job.returnvalue;
        if (!(await this.cache.get(jobId))) {
          // Audio was purged after the job finished; submit() will re-queue it.
          return {
            jobId,
            status: 'failed',
            error: 'Audio đã bị xoá khỏi cache, hãy tạo lại',
          };
        }
        return {
          jobId,
          status: 'completed',
          cached: false,
          audioUrl: audioUrl(r.hash, r.ext),
          duration: r.duration,
        };
      }
      case 'failed':
        return { jobId, status: 'failed', error: job.failedReason };
      case 'active':
        return { jobId, status: 'active', progress: progressOf(job) };
      default:
        return {
          jobId,
          status: 'waiting',
          position: await this.positionOf(job),
        };
    }
  }

  private async positionOf(job: Job): Promise<number> {
    const [waiting, active] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActiveCount(),
    ]);
    const ahead = waiting.filter(
      (j) =>
        j.timestamp < job.timestamp ||
        (j.timestamp === job.timestamp && j.id! < job.id!),
    );
    return ahead.length + active;
  }

  private fromCache(e: CacheEntry): JobView {
    return {
      jobId: e.hash,
      status: 'completed',
      cached: true,
      audioUrl: audioUrl(e.hash, e.ext),
      duration: e.duration,
    };
  }
}

const audioUrl = (hash: string, ext: string) => `/api/audio/${hash}.${ext}`;
const progressOf = (job: Job) =>
  typeof job.progress === 'number' ? job.progress : 0;
