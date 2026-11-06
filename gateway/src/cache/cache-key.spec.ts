import { cacheKey, normalizeText, roundSpeed } from './cache-key';

describe('cache-key', () => {
  const base = {
    modelTag: 'm1',
    text: 'xin chào',
    voice: 'Hải Đăng',
    speed: 1,
    format: 'mp3' as const,
  };

  it('normalizes whitespace and unicode form', () => {
    const nfd = 'Xin   chào\n\tbạn '.normalize('NFD');
    expect(normalizeText(nfd)).toBe('Xin chào bạn');
    expect(normalizeText(nfd)).toBe(normalizeText('Xin chào bạn'));
  });

  it('rounds speed to 0.05 steps', () => {
    expect(roundSpeed(1.02)).toBe(1);
    expect(roundSpeed(1.03)).toBe(1.05);
    expect(roundSpeed(1.234)).toBe(1.25);
  });

  it('is a stable sha256 hex', () => {
    const k = cacheKey(base);
    expect(k).toMatch(/^[a-f0-9]{64}$/);
    expect(cacheKey({ ...base })).toBe(k);
  });

  it.each([
    ['modelTag', { modelTag: 'm2' }],
    ['text', { text: 'xin chào bạn' }],
    ['voice', { voice: 'Mai Anh' }],
    ['speed', { speed: 1.05 }],
    ['format', { format: 'wav' as const }],
  ])('changes when %s changes', (_, patch) => {
    expect(cacheKey({ ...base, ...patch })).not.toBe(cacheKey(base));
  });

  it('treats NFC/NFD voice names the same', () => {
    expect(cacheKey({ ...base, voice: 'Hải Đăng'.normalize('NFD') })).toBe(
      cacheKey(base),
    );
  });
});
