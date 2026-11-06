import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import { appConfig, type AppConfig } from '../config/app.config';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisCloser implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [appConfig.KEY],
      useFactory: (cfg: AppConfig) =>
        new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3 }),
    },
    RedisCloser,
  ],
  exports: [REDIS],
})
export class RedisModule {}
