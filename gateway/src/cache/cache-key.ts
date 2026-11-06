import { createHash } from 'node:crypto';
import { SPEED_STEP, type AudioFormat } from '../common/constants';

export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function roundSpeed(speed: number): number {
  return Number((Math.round(speed / SPEED_STEP) * SPEED_STEP).toFixed(2));
}

export interface CacheKeyInput {
  modelTag: string;
  text: string;
  voice: string;
  speed: number;
  format: AudioFormat;
}

/** Caller must pass already-normalized text/speed (see normalizeText/roundSpeed). */
export function cacheKey(i: CacheKeyInput): string {
  const payload = JSON.stringify([
    i.modelTag,
    i.text,
    i.voice.normalize('NFC'),
    i.speed.toFixed(2),
    i.format,
  ]);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
