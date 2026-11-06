import type { AudioFormat } from '../common/constants';

export interface TtsJobData {
  hash: string;
  text: string;
  voice: string;
  speed: number;
  format: AudioFormat;
}

export interface TtsJobResult {
  hash: string;
  ext: AudioFormat;
  duration: number;
}

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';

export interface JobView {
  jobId: string;
  status: JobStatus;
  /** Number of jobs ahead of this one (waiting + active). Only set while waiting. */
  position?: number;
  progress?: number;
  cached?: boolean;
  audioUrl?: string;
  duration?: number;
  error?: string;
}
