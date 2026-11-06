import { Module } from '@nestjs/common';
import { TtsClientModule } from '../tts-client/tts-client.module';
import { VoicesController } from './voices.controller';
import { VoicesService } from './voices.service';

@Module({
  imports: [TtsClientModule],
  controllers: [VoicesController],
  providers: [VoicesService],
  exports: [VoicesService],
})
export class VoicesModule {}
