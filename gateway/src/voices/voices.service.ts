import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RegionId } from '../common/constants';
import {
  RemoteVoice,
  TtsClientService,
} from '../tts-client/tts-client.service';

const TTL_MS = 10 * 60_000;

@Injectable()
export class VoicesService {
  private readonly logger = new Logger(VoicesService.name);
  private cache?: { at: number; voices: RemoteVoice[] };
  private inflight?: Promise<RemoteVoice[]>;

  constructor(private readonly client: TtsClientService) {}

  async list(region?: RegionId): Promise<RemoteVoice[]> {
    const all = await this.all();
    return region ? all.filter((v) => v.region === region) : all;
  }

  /** Throws 400 if the voice does not exist or is not in the requested region. */
  async assertVoiceInRegion(
    voiceId: string,
    region: RegionId,
  ): Promise<RemoteVoice> {
    const voice = (await this.all()).find((v) => v.id === voiceId);
    if (!voice)
      throw new BadRequestException(`Giọng "${voiceId}" không tồn tại`);
    if (voice.region !== region) {
      throw new BadRequestException(
        `Giọng "${voiceId}" không thuộc vùng "${region}" (thuộc "${voice.region}")`,
      );
    }
    return voice;
  }

  private async all(): Promise<RemoteVoice[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS)
      return this.cache.voices;
    this.inflight ??= this.client
      .voices()
      .then((voices) => {
        this.cache = { at: Date.now(), voices };
        return voices;
      })
      .finally(() => (this.inflight = undefined));
    try {
      return await this.inflight;
    } catch (e) {
      if (this.cache) {
        this.logger.warn(`Using stale voice list: ${(e as Error).message}`);
        return this.cache.voices;
      }
      throw new ServiceUnavailableException('TTS service chưa sẵn sàng');
    }
  }
}
