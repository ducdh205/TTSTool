import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AUDIO_FILE_RE, type AudioFormat } from '../common/constants';
import { AudioCacheService } from './audio-cache.service';

@Controller('audio')
export class AudioController {
  constructor(private readonly cache: AudioCacheService) {}

  /** Serves cached audio with Range support. File name is validated so no path traversal is possible. */
  @Get(':file')
  serve(@Param('file') file: string, @Res() res: Response) {
    const m = AUDIO_FILE_RE.exec(file);
    if (!m) throw new NotFoundException();
    const path = this.cache.filePath(m[1], m[2] as AudioFormat);
    res.sendFile(
      path,
      { headers: { 'Cache-Control': 'public, max-age=604800, immutable' } },
      (err) => {
        if (err && !res.headersSent)
          res.status(404).json({ statusCode: 404, message: 'Not Found' });
      },
    );
  }
}
