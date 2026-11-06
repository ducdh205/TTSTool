import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AudioCacheModule } from '../cache/cache.module';
import { TTS_QUEUE } from '../common/constants';
import { TtsClientModule } from '../tts-client/tts-client.module';
import { VoicesModule } from '../voices/voices.module';
import { TtsController } from './tts.controller';
import { TtsProcessor } from './tts.processor';
import { TtsService } from './tts.service';

@Module({
  imports: [BullModule.registerQueue({ name: TTS_QUEUE }), AudioCacheModule, TtsClientModule, VoicesModule],
  controllers: [TtsController],
  providers: [TtsService, TtsProcessor],
})
export class TtsModule {}
