export const TTS_QUEUE = 'tts';

export const REGIONS = [
  { id: 'bac', label: 'Miền Bắc' },
  { id: 'trung', label: 'Miền Trung' },
  { id: 'nam', label: 'Miền Nam' },
  { id: 'khac', label: 'Khác' },
] as const;
export type RegionId = (typeof REGIONS)[number]['id'];
export const REGION_IDS = REGIONS.map((r) => r.id) as RegionId[];

export const AUDIO_FORMATS = ['mp3', 'wav'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.0;
export const SPEED_STEP = 0.05;
/** Must stay <= MAX_CHARS of tts-service. Static because DTO decorators need it at import time. */
export const MAX_TEXT_LEN = 3000;

/** sha256 hex — used for job ids, cache keys and audio file names. */
export const HASH_RE = /^[a-f0-9]{64}$/;
export const AUDIO_FILE_RE = /^([a-f0-9]{64})\.(mp3|wav)$/;
