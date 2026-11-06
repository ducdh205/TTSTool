import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfig } from '../config/app.config';
import type { AudioFormat, RegionId } from '../common/constants';

export interface RemoteVoice {
  id: string;
  name: string;
  region: RegionId;
  gender: string | null;
  description: string | null;
  isDefault: boolean;
}

export interface SynthesizeRequest {
  text: string;
  voice: string;
  speed: number;
  format: AudioFormat;
}

export interface SynthesizeResult {
  data: Buffer;
  duration: number;
}

/** status: HTTP status from tts-service, or 0 for network/timeout errors. */
export class TtsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  get isClientError() {
    return this.status >= 400 && this.status < 500;
  }
}

@Injectable()
export class TtsClientService {
  constructor(@Inject(appConfig.KEY) private readonly cfg: AppConfig) {}

  async voices(): Promise<RemoteVoice[]> {
    const res = await this.call('/voices', { method: 'GET' }, 10_000);
    return (await res.json()) as RemoteVoice[];
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const res = await this.call(
      '/synthesize',
      {
        method: 'POST',
        body: JSON.stringify(req),
        headers: { 'content-type': 'application/json' },
      },
      this.cfg.ttsTimeoutMs,
    );
    const data = Buffer.from(await res.arrayBuffer());
    const duration = Number(res.headers.get('x-audio-duration') ?? 0);
    return { data, duration };
  }

  private async call(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.cfg.ttsServiceUrl + path, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          'x-internal-key': this.cfg.internalApiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new TtsServiceError(
        `tts-service unreachable: ${(e as Error).message}`,
        0,
      );
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { detail?: unknown };
        detail =
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail ?? body);
      } catch {
        /* non-JSON error body */
      }
      throw new TtsServiceError(detail, res.status);
    }
    return res;
  }
}
