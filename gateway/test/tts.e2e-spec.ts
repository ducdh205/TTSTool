import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TtsClientService } from '../src/tts-client/tts-client.service';

// Real Redis + BullMQ, fake tts-service. Needs redis-server on 127.0.0.1:6379 (uses db 15).
const REDIS_URL = 'redis://127.0.0.1:6379/15';
const audioDir = mkdtempSync(join(tmpdir(), 'tts-e2e-'));
process.env.REDIS_URL = REDIS_URL;
process.env.AUDIO_DIR = audioDir;
process.env.MODEL_TAG = `e2e-${Date.now()}`;
const testcaseDir = mkdtempSync(join(tmpdir(), 'tts-e2e-tc-'));
process.env.TESTCASE_DIR = testcaseDir;
writeFileSync(join(testcaseDir, 'Bộ test 1.xlsx'), 'xlsx-bytes');
writeFileSync(join(testcaseDir, '~$lock.xlsx'), 'lock');
writeFileSync(join(testcaseDir, 'note.txt'), 'note');

const voices = [
  {
    id: 'Hải Đăng',
    name: 'Hải Đăng',
    region: 'bac',
    gender: 'male',
    description: null,
    isDefault: true,
  },
  {
    id: 'Thùy Dung',
    name: 'Thùy Dung',
    region: 'nam',
    gender: 'female',
    description: null,
    isDefault: false,
  },
];

const fakeClient = {
  voices: jest.fn().mockResolvedValue(voices),
  synthesize: jest.fn().mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { data: Buffer.from('ID3fake-mp3-bytes'), duration: 1.23 };
  }),
};

async function waitDone(app: App, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const r = await request(app).get(`/api/tts/jobs/${jobId}`).expect(200);
    if (r.body.status === 'completed' || r.body.status === 'failed')
      return r.body;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('job did not finish');
}

describe('Gateway (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;

  beforeAll(async () => {
    const r = new Redis(REDIS_URL);
    await r.flushdb();
    await r.quit();
    // appConfig (registerAs) reads process.env when the module is compiled, i.e. after the env setup above.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TtsClientService)
      .useValue(fakeClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(audioDir, { recursive: true, force: true });
    rmSync(testcaseDir, { recursive: true, force: true });
  });

  it('lists regions and voices filtered by region', async () => {
    const regions = await request(http).get('/api/regions').expect(200);
    expect(regions.body.map((r: { id: string }) => r.id)).toEqual([
      'bac',
      'trung',
      'nam',
      'khac',
    ]);
    const nam = await request(http).get('/api/voices?region=nam').expect(200);
    expect(nam.body.map((v: { id: string }) => v.id)).toEqual(['Thùy Dung']);
    await request(http).get('/api/voices?region=xyz').expect(400);
  });

  it('rejects voice outside the selected region and bad payloads', async () => {
    await request(http)
      .post('/api/tts')
      .send({ text: 'a', region: 'nam', voice: 'Hải Đăng' })
      .expect(400);
    await request(http)
      .post('/api/tts')
      .send({ text: '   ', region: 'bac', voice: 'Hải Đăng' })
      .expect(400);
    await request(http)
      .post('/api/tts')
      .send({ text: 'a', region: 'bac', voice: 'Hải Đăng', speed: 5 })
      .expect(400);
    await request(http)
      .post('/api/tts')
      .send({ text: 'a', region: 'bac', voice: 'Hải Đăng', hack: 1 })
      .expect(400);
  });

  it('queues, completes, serves audio, then hits cache', async () => {
    const body = {
      text: 'Xin  chào   Việt Nam',
      region: 'bac',
      voice: 'Hải Đăng',
      speed: 1.21,
    };
    const first = await request(http).post('/api/tts').send(body).expect(202);
    expect(first.body.jobId).toMatch(/^[a-f0-9]{64}$/);

    const done = await waitDone(http, first.body.jobId);
    expect(done).toMatchObject({
      status: 'completed',
      cached: false,
      duration: 1.23,
    });
    expect(fakeClient.synthesize).toHaveBeenLastCalledWith({
      text: 'Xin chào Việt Nam',
      voice: 'Hải Đăng',
      speed: 1.2,
      format: 'mp3',
    });

    const audio = await request(http).get(done.audioUrl).expect(200);
    expect(audio.headers['content-type']).toContain('audio/mpeg');
    expect(Buffer.from(audio.body as Buffer).toString()).toBe(
      'ID3fake-mp3-bytes',
    );

    const calls = fakeClient.synthesize.mock.calls.length;
    // Same request after normalization (whitespace, speed rounding) -> cache hit, no new synthesis.
    const again = await request(http)
      .post('/api/tts')
      .send({ ...body, text: 'Xin chào Việt Nam ', speed: 1.19 })
      .expect(200);
    expect(again.body).toMatchObject({
      status: 'completed',
      cached: true,
      jobId: first.body.jobId,
    });
    expect(fakeClient.synthesize.mock.calls.length).toBe(calls);
  });

  it('collapses identical in-flight requests onto one job', async () => {
    const calls = fakeClient.synthesize.mock.calls.length;
    const mk = (text: string) => ({ text, region: 'nam', voice: 'Thùy Dung' });
    const [a, b, c] = await Promise.all([
      request(http).post('/api/tts').send(mk('một')),
      request(http).post('/api/tts').send(mk('một')),
      request(http).post('/api/tts').send(mk('hai')),
    ]);
    expect(a.body.jobId).toBe(b.body.jobId);
    expect(c.body.jobId).not.toBe(a.body.jobId);
    await Promise.all([
      waitDone(http, a.body.jobId),
      waitDone(http, c.body.jobId),
    ]);
    expect(fakeClient.synthesize.mock.calls.length - calls).toBe(2);
  });

  it('accepts NFD-encoded voice names', async () => {
    const r = await request(http)
      .post('/api/tts')
      .send({ text: 'ba', region: 'bac', voice: 'Hải Đăng'.normalize('NFD') });
    expect([200, 202]).toContain(r.status);
    await waitDone(http, r.body.jobId);
    expect(fakeClient.synthesize).toHaveBeenLastCalledWith(
      expect.objectContaining({ voice: 'Hải Đăng'.normalize('NFC') }),
    );
  });

  it('does not allow path traversal or unknown jobs', async () => {
    await request(http).get('/api/audio/..%2F..%2Fetc%2Fpasswd').expect(404);
    await request(http)
      .get(`/api/audio/${'a'.repeat(64)}.mp3`)
      .expect(404);
    await request(http).get('/api/tts/jobs/not-a-hash').expect(404);
    await request(http)
      .get(`/api/tts/jobs/${'b'.repeat(64)}`)
      .expect(404);
  });

  it('batch submit keeps order, isolates bad items and dedups', async () => {
    const ok = { text: 'lô một', region: 'bac', voice: 'Hải Đăng' };
    const res = await request(http)
      .post('/api/tts/batch')
      .send({
        items: [ok, { text: 'lô hai', region: 'nam', voice: 'Hải Đăng' }, ok],
      })
      .expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[1]).toMatchObject({ jobId: '', status: 'failed' });
    expect(res.body[1].error).toEqual(expect.any(String));
    expect(res.body[0].jobId).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body[2].jobId).toBe(res.body[0].jobId);
    expect((await waitDone(http, res.body[0].jobId)).status).toBe('completed');

    const missing = 'f'.repeat(64);
    const st = await request(http)
      .post('/api/tts/jobs/status')
      .send({ ids: [res.body[0].jobId, missing] })
      .expect(200);
    expect(st.body).toEqual([
      expect.objectContaining({
        jobId: res.body[0].jobId,
        status: 'completed',
      }),
      { jobId: missing, status: 'failed', error: 'Job không tồn tại' },
    ]);
  });

  it('rejects empty batch and malformed status ids', async () => {
    await request(http).post('/api/tts/batch').send({ items: [] }).expect(400);
    await request(http)
      .post('/api/tts/batch')
      .send({ items: [{ text: 'x', region: 'bac' }] })
      .expect(400);
    await request(http)
      .post('/api/tts/jobs/status')
      .send({ ids: ['bad'] })
      .expect(400);
  });

  it('lists testcase workbooks only', async () => {
    const r = await request(http).get('/api/testcases').expect(200);
    expect(r.body).toEqual([
      {
        name: 'Bộ test 1.xlsx',
        size: 10,
        mtime: expect.any(String),
        url: '/api/testcases/B%E1%BB%99%20test%201.xlsx',
      },
    ]);
  });

  it('downloads a workbook from TESTCASE_DIR (outside public/)', async () => {
    const r = await request(http)
      .get('/api/testcases/B%E1%BB%99%20test%201.xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((r.body as Buffer).toString()).toBe('xlsx-bytes');
    expect(r.headers['content-type']).toContain('spreadsheetml');
  });

  it('refuses traversal, non-xlsx and missing workbooks', async () => {
    await request(http)
      .get('/api/testcases/..%2F..%2Fpackage.json')
      .expect(404);
    await request(http).get('/api/testcases/note.txt').expect(404);
    await request(http).get('/api/testcases/missing.xlsx').expect(404);
  });
});
