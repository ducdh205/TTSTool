import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AppConfig } from '../config/app.config';
import type { AudioCacheService } from '../cache/audio-cache.service';
import type { VoicesService } from '../voices/voices.service';
import type { CreateTtsDto } from './create-tts.dto';
import { TtsService } from './tts.service';

const makeService = () =>
  new TtsService(
    {} as never,
    {} as AppConfig,
    {} as AudioCacheService,
    {} as VoicesService,
  );

const item = (text: string): CreateTtsDto => ({
  text,
  region: 'bac',
  voice: 'Hải Đăng',
});

describe('TtsService batch', () => {
  it('submitMany keeps order and isolates errors', async () => {
    const svc = makeService();
    jest
      .spyOn(svc, 'submit')
      .mockResolvedValueOnce({ jobId: 'a', status: 'waiting' })
      .mockRejectedValueOnce(
        new BadRequestException('Giọng X không thuộc vùng nam'),
      )
      .mockResolvedValueOnce({ jobId: 'c', status: 'completed' });

    const out = await svc.submitMany([item('1'), item('2'), item('3')]);

    expect(out).toEqual([
      { jobId: 'a', status: 'waiting' },
      { jobId: '', status: 'failed', error: 'Giọng X không thuộc vùng nam' },
      { jobId: 'c', status: 'completed' },
    ]);
  });

  it('statusMany does not compute queue positions (O(n) per id)', async () => {
    const getWaiting = jest.fn().mockResolvedValue([]);
    const queue = {
      getJob: jest.fn().mockResolvedValue({
        id: 'a',
        timestamp: 1,
        getState: jest.fn().mockResolvedValue('waiting'),
      }),
      getWaiting,
      getActiveCount: jest.fn().mockResolvedValue(0),
    };
    const svc = new TtsService(
      queue as never,
      {} as AppConfig,
      {} as AudioCacheService,
      {} as VoicesService,
    );
    const id = 'a'.repeat(64);

    await expect(svc.statusMany([id, id])).resolves.toEqual([
      { jobId: id, status: 'waiting' },
      { jobId: id, status: 'waiting' },
    ]);
    expect(getWaiting).not.toHaveBeenCalled();

    await svc.status(id);
    expect(getWaiting).toHaveBeenCalledTimes(1);
  });

  it('submitMany asks submit() not to compute queue positions', async () => {
    const svc = makeService();
    const submit = jest
      .spyOn(svc, 'submit')
      .mockResolvedValue({ jobId: 'a', status: 'waiting' });
    await svc.submitMany([item('1')]);
    expect(submit).toHaveBeenCalledWith(item('1'), false);
  });

  it('statusMany maps NotFound to failed', async () => {
    const svc = makeService();
    const id = 'f'.repeat(64);
    jest
      .spyOn(svc, 'status')
      .mockRejectedValueOnce(new NotFoundException('Job không tồn tại'));

    await expect(svc.statusMany([id])).resolves.toEqual([
      { jobId: id, status: 'failed', error: 'Job không tồn tại' },
    ]);
  });
});
