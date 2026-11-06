import { resolve } from 'node:path';
import { registerAs } from '@nestjs/config';

const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const appConfig = registerAs('app', () => ({
  port: int(process.env.PORT, 3000),
  ttsServiceUrl: (
    process.env.TTS_SERVICE_URL ?? 'http://127.0.0.1:8001'
  ).replace(/\/+$/, ''),
  internalApiKey: process.env.INTERNAL_API_KEY ?? 'change-me',
  ttsTimeoutMs: int(process.env.TTS_TIMEOUT_MS, 5 * 60_000),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  audioDir: resolve(process.env.AUDIO_DIR ?? './storage/audio'),
  cacheTtlDays: int(process.env.CACHE_TTL_DAYS, 7),
  queueConcurrency: int(process.env.QUEUE_CONCURRENCY, 1),
  /** Part of the cache key: bump when model/precision changes so old audio is not reused. */
  modelTag: process.env.MODEL_TAG ?? 'vieneu-v3turbo-int8',
}));

export type AppConfig = ReturnType<typeof appConfig>;

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
  };
}
