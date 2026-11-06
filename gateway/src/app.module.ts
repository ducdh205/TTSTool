import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { appConfig, redisConnection, type AppConfig } from './config/app.config';
import { RedisModule } from './redis/redis.module';
import { TtsModule } from './tts/tts.module';
import { VoicesModule } from './voices/voices.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (cfg: AppConfig) => ({ connection: redisConnection(cfg.redisUrl) }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*path}'],
    }),
    RedisModule,
    VoicesModule,
    TtsModule,
  ],
})
export class AppModule {}
