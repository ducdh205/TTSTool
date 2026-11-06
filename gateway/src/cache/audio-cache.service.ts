import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type Redis from 'ioredis';
import { AUDIO_FILE_RE, HASH_RE, type AudioFormat } from '../common/constants';
import { appConfig, type AppConfig } from '../config/app.config';
import { REDIS } from '../redis/redis.module';

export interface CacheEntry {
  hash: string;
  ext: AudioFormat;
  duration: number;
  size: number;
  createdAt: string;
}

const KEY_PREFIX = 'tts:cache:';
const CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;
const TMP_MAX_AGE_MS = 60 * 60_000;

/** Audio bytes live on disk; Redis holds metadata with TTL. An entry is valid only if both exist. */
@Injectable()
export class AudioCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AudioCacheService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(appConfig.KEY) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await mkdir(this.cfg.audioDir, { recursive: true });
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
    void this.cleanup();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  filePath(hash: string, ext: AudioFormat): string {
    if (!HASH_RE.test(hash)) throw new Error('invalid hash');
    return join(this.cfg.audioDir, `${hash}.${ext}`);
  }

  async get(hash: string): Promise<CacheEntry | null> {
    const raw = await this.redis.get(KEY_PREFIX + hash);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    try {
      await stat(this.filePath(hash, entry.ext));
      return entry;
    } catch {
      await this.redis.del(KEY_PREFIX + hash);
      return null;
    }
  }

  async put(
    hash: string,
    ext: AudioFormat,
    data: Buffer,
    duration: number,
  ): Promise<CacheEntry> {
    const target = this.filePath(hash, ext);
    const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    await writeFile(tmp, data);
    await rename(tmp, target);
    const entry: CacheEntry = {
      hash,
      ext,
      duration,
      size: data.length,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(
      KEY_PREFIX + hash,
      JSON.stringify(entry),
      'EX',
      this.cfg.cacheTtlDays * 86_400,
    );
    return entry;
  }

  /** Delete audio files whose Redis metadata expired, plus stale temp files. */
  async cleanup(): Promise<number> {
    let removed = 0;
    try {
      for (const name of await readdir(this.cfg.audioDir)) {
        const path = join(this.cfg.audioDir, name);
        const m = AUDIO_FILE_RE.exec(name);
        if (m) {
          if (!(await this.redis.exists(KEY_PREFIX + m[1]))) {
            await unlink(path).catch(() => undefined);
            removed++;
          }
        } else if (name.includes('.tmp-')) {
          const s = await stat(path).catch(() => null);
          if (s && Date.now() - s.mtimeMs > TMP_MAX_AGE_MS) {
            await unlink(path).catch(() => undefined);
            removed++;
          }
        }
      }
      if (removed) this.logger.log(`Cache cleanup removed ${removed} file(s)`);
    } catch (e) {
      this.logger.warn(`Cache cleanup failed: ${(e as Error).message}`);
    }
    return removed;
  }
}
