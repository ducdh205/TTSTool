import { Controller, Get, Inject } from '@nestjs/common';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig, type AppConfig } from '../config/app.config';

export interface TestcaseFile {
  name: string;
  size: number;
  mtime: string;
  url: string;
}

@Controller('testcases')
export class TestcasesController {
  constructor(@Inject(appConfig.KEY) private readonly cfg: AppConfig) {}

  /** .xlsx workbooks in TESTCASE_DIR (not recursive; Excel lock files "~$..." skipped). */
  @Get()
  async list(): Promise<TestcaseFile[]> {
    const dir = this.cfg.testcaseDir;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const names = entries
      .filter(
        (d) =>
          d.isFile() && /\.xlsx$/i.test(d.name) && !d.name.startsWith('~$'),
      )
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'vi'));
    return Promise.all(
      names.map(async (name) => {
        const s = await stat(join(dir, name));
        return {
          name,
          size: s.size,
          mtime: s.mtime.toISOString(),
          url: `/testcase/${encodeURIComponent(name)}`,
        };
      }),
    );
  }
}
