import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { RemoteVoice, TtsClientService } from '../tts-client/tts-client.service';
import { VoicesService } from './voices.service';

const v = (id: string, region: RemoteVoice['region']): RemoteVoice => ({
  id,
  name: id,
  region,
  gender: null,
  description: null,
  isDefault: false,
});

describe('VoicesService', () => {
  const voices = [v('Phạm Tuyên', 'bac'), v('Quang Sơn', 'trung'), v('Thái Sơn', 'nam')];
  let client: { voices: jest.Mock };
  let svc: VoicesService;

  beforeEach(() => {
    client = { voices: jest.fn().mockResolvedValue(voices) };
    svc = new VoicesService(client as unknown as TtsClientService);
  });

  it('filters by region and memoizes the remote call', async () => {
    expect((await svc.list('trung')).map((x) => x.id)).toEqual(['Quang Sơn']);
    expect(await svc.list()).toHaveLength(3);
    expect(client.voices).toHaveBeenCalledTimes(1);
  });

  it('accepts a voice in the right region', async () => {
    await expect(svc.assertVoiceInRegion('Thái Sơn', 'nam')).resolves.toMatchObject({ id: 'Thái Sơn' });
  });

  it('rejects unknown voice or wrong region', async () => {
    await expect(svc.assertVoiceInRegion('Nobody', 'bac')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.assertVoiceInRegion('Thái Sơn', 'bac')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 503 when tts-service is down and nothing is cached', async () => {
    client.voices.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.list()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
