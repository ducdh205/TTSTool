import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { appConfig, type AppConfig } from '../config/app.config';

export interface TestcaseFile {
  name: string;
  size: number;
  mtime: string;
  url: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** .xlsx, and not an Excel lock file ("~$..."). */
const isWorkbookName = (name: string) =>
  /\.xlsx$/i.test(name) && !name.startsWith('~$');

@Controller('testcases')
export class TestcasesController {
  constructor(@Inject(appConfig.KEY) private readonly cfg: AppConfig) {}

  /** Workbooks in TESTCASE_DIR (not recursive). */
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
      .filter((d) => d.isFile() && isWorkbookName(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'vi'));
    return Promise.all(
      names.map(async (name) => {
        const s = await stat(join(dir, name));
        return {
          name,
          size: s.size,
          mtime: s.mtime.toISOString(),
          url: `/api/testcases/${encodeURIComponent(name)}`,
        };
      }),
    );
  }

  /** Streams one workbook; the name must be a plain .xlsx file name inside TESTCASE_DIR. */
  @Get(':name')
  async download(@Param('name') name: string): Promise<StreamableFile> {
    if (name !== basename(name) || !isWorkbookName(name)) {
      throw new NotFoundException('File không tồn tại');
    }
    const path = join(this.cfg.testcaseDir, name);
    const s = await stat(path).catch(() => null);
    if (!s?.isFile()) throw new NotFoundException('File không tồn tại');
    return new StreamableFile(createReadStream(path), {
      type: XLSX_TYPE,
      length: s.size,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  }
}
