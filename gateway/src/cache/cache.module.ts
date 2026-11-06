import { Module } from '@nestjs/common';
import { AudioCacheService } from './audio-cache.service';
import { AudioController } from './audio.controller';

@Module({
  controllers: [AudioController],
  providers: [AudioCacheService],
  exports: [AudioCacheService],
})
export class AudioCacheModule {}
