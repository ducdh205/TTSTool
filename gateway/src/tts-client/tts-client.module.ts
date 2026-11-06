import { Module } from '@nestjs/common';
import { TtsClientService } from './tts-client.service';

@Module({ providers: [TtsClientService], exports: [TtsClientService] })
export class TtsClientModule {}
