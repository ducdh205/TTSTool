// The parser lives in public/ (plain browser JS, UMD) and is shared with Jest via require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const P = require('../../public/testcase-parse.js') as TestcaseParse;

type Region = 'bac' | 'trung' | 'nam';
interface Row {
  index: number;
  tcId: string;
  step: number;
  title: string;
  regionRaw: string;
  region: Region;
  speaker: string;
  utterance: string;
  expected: string;
  wakeWord: boolean;
  speech: boolean;
  warnings: string[];
}
interface TestcaseParse {
  findHeader(rows: unknown[][]): {
    headerIndex: number;
    cols: Record<string, number>;
  } | null;
  mapRegion(raw: unknown): { region: Region; warning?: string };
  wakeWordWanted(step: number, precondition: unknown): boolean;
  isSpeech(speaker: unknown): boolean;
  parseSheet(rows: unknown[][]): Row[] | null;
  clipKey(voice: string, text: string): string;
  rowStatus(clips: ({ status: string; error?: string } | undefined)[]): {
    s: 'need' | 'wait' | 'ok' | 'err';
    error?: string;
  };
  REGION_DEFAULT_VOICES: Record<Region, string>;
}

const HEADER = [
  'TC_ID',
  'Cụm tính năng',
  'Use case / Req ID',
  'Tiêu đề test case',
  'Mức ưu tiên',
  'Loại test',
  'Mã lĩnh vực KT (A–V)',
  'Vùng miền',
  'Bước / Lượt',
  'Tiền điều kiện & môi trường',
  'Các bước thực hiện',
  'Người nói',
  'Câu nói (utterance)',
  'Kết quả mong đợi',
];
const PREAMBLE = [
  ['TEST CASE E2E – VOICE ASSISTANT'],
  ['Cột nền xanh nhạt: ...'],
  ['THÔNG TIN CHUNG', 'ĐẦU VÀO', 'MONG ĐỢI'],
];
const row = (o: {
  tc: string;
  region?: unknown;
  step?: unknown;
  pre?: string;
  speaker?: string;
  utt?: unknown;
}) => {
  const r: unknown[] = new Array(HEADER.length).fill('');
  r[0] = o.tc;
  r[3] = `Tiêu đề ${o.tc}`;
  r[7] = o.region ?? 'BAC-HN';
  r[8] = o.step ?? '1';
  r[9] = o.pre ?? 'Xe: VF 6\nWake-word: Hey Vita\nCách phát: ...';
  r[11] = o.speaker ?? '👤 Người dùng';
  r[12] = o.utt ?? 'Mở kính';
  r[13] = `Mong đợi ${o.tc}`;
  return r;
};

describe('mapRegion', () => {
  it.each([
    ['BAC-HN', 'bac'],
    ['bac_hn', 'bac'],
    ['TRUNG-HUE', 'trung'],
    ['TRUNG-NA', 'trung'],
    ['NAM-HCM', 'nam'],
  ])('%s -> %s without warning', (raw, region) => {
    expect(P.mapRegion(raw)).toEqual({ region });
  });

  it('takes the first of several regions with a warning', () => {
    expect(P.mapRegion('NAM-HCM / TRUNG-HUE')).toEqual({
      region: 'nam',
      warning: 'Nhiều vùng, dùng NAM-HCM',
    });
  });

  it.each([[null], [''], ['1.0']])(
    'falls back to bac with a warning for %p',
    (raw) => {
      const r = P.mapRegion(raw);
      expect(r.region).toBe('bac');
      expect(r.warning).toMatch(/^Vùng không nhận ra/);
    },
  );
});

describe('wakeWordWanted', () => {
  it('wants the wake word on step 1 with Hey Vita', () => {
    expect(
      P.wakeWordWanted(1, 'Xe: VF 6\nWake-word: Hey Vita\nCách phát: x'),
    ).toBe(true);
  });
  it('never on step 2+', () => {
    expect(P.wakeWordWanted(2, 'Wake-word: Hey Vita')).toBe(false);
  });
  it.each([
    'Không nói wake-word',
    'Không nói wake-word (câu gần âm)',
    'Không cần',
    'Không gọi',
    'Không (sự kiện pin)',
    'Nút thoại vô-lăng (KQ Wake ghi N/A)',
  ])('not when precondition says "%s"', (v) => {
    expect(P.wakeWordWanted(1, `Xe: VF 6\nWake-word: ${v}\nKhác: y`)).toBe(
      false,
    );
  });
  it('wants it when precondition has no Wake-word line or says Vita ơi', () => {
    expect(P.wakeWordWanted(1, 'Xe: VF 6')).toBe(true);
    expect(P.wakeWordWanted(1, null)).toBe(true);
    expect(P.wakeWordWanted(1, 'Wake-word: Vita ơi')).toBe(true);
  });
});

describe('isSpeech', () => {
  it.each(['👤 Người dùng', '👤 Hành khách TP', '👶 Trẻ em ghế sau'])(
    '%s speaks',
    (s) => expect(P.isSpeech(s)).toBe(true),
  );
  it.each([
    '— (không có lời nói)',
    '🔧 Tester (thao tác)',
    '⚙️ Giả lập HIL/CAN',
    '📻 Loa media',
  ])('%s does not speak', (s) => expect(P.isSpeech(s)).toBe(false));
});

describe('findHeader', () => {
  it('finds the header row and named columns', () => {
    const h = P.findHeader([...PREAMBLE, HEADER, row({ tc: 'A' })]);
    expect(h).not.toBeNull();
    expect(h!.headerIndex).toBe(3);
    expect(h!.cols).toMatchObject({
      tcId: 0,
      title: 3,
      region: 7,
      step: 8,
      precondition: 9,
      speaker: 11,
      utterance: 12,
      expected: 13,
    });
  });
  it('returns null when Câu nói / Vùng miền are missing', () => {
    expect(P.findHeader([['Mã', 'Rule', 'Cách kiểm tra']])).toBeNull();
    expect(P.findHeader([])).toBeNull();
  });
});

describe('parseSheet', () => {
  const rows = [
    ...PREAMBLE,
    HEADER,
    row({ tc: 'TC-1' }),
    row({ tc: 'TC-1', step: '2', utt: 'Có, mở đi' }),
    row({ tc: 'TC-2', utt: '' }),
    row({ tc: 'TC-3', speaker: '🔧 Tester (thao tác)' }),
    row({ tc: 'TC-4', step: 'Trạng thái hệ thống: CTX-01 Xe đỗ...' }),
  ];
  const out = P.parseSheet(rows)!;

  it('skips rows without an utterance and numbers rows like Excel', () => {
    expect(out.map((r) => r.tcId)).toEqual(['TC-1', 'TC-1', 'TC-3', 'TC-4']);
    expect(out[0]).toMatchObject({
      index: 5,
      tcId: 'TC-1',
      step: 1,
      title: 'Tiêu đề TC-1',
      regionRaw: 'BAC-HN',
      region: 'bac',
      speaker: '👤 Người dùng',
      utterance: 'Mở kính',
      expected: 'Mong đợi TC-1',
      wakeWord: true,
      speech: true,
      warnings: [],
    });
  });
  it('turns off the wake word on step 2', () => {
    expect(out[1]).toMatchObject({ step: 2, wakeWord: false });
  });
  it('marks non-speech speakers', () => {
    expect(out[2].speech).toBe(false);
  });
  it('survives a shifted step cell', () => {
    expect(out[3]).toMatchObject({ step: 1, speech: true });
    expect(out[3].warnings).toContain('Bước không hợp lệ');
  });
  it('rejects utterances over 3000 chars', () => {
    const long = P.parseSheet([
      HEADER,
      row({ tc: 'L', utt: 'a'.repeat(3001) }),
    ])!;
    expect(long[0].speech).toBe(false);
    expect(long[0].warnings).toContain('Câu nói quá 3000 ký tự');
  });
  it('carries region warnings', () => {
    const r = P.parseSheet([
      HEADER,
      row({ tc: 'R', region: 'NAM-HCM / TRUNG-HUE' }),
    ])!;
    expect(r[0].region).toBe('nam');
    expect(r[0].warnings).toEqual(['Nhiều vùng, dùng NAM-HCM']);
  });
  it('returns null for sheets without the needed columns', () => {
    expect(P.parseSheet([['Mã', 'Rule']])).toBeNull();
  });
});

describe('clipKey and defaults', () => {
  it('normalizes whitespace and NFC', () => {
    expect(P.clipKey('Hải Đăng'.normalize('NFD'), '  Mở   kính ')).toBe(
      'Hải Đăng|Mở kính',
    );
  });
  it('maps regions to the agreed default voices', () => {
    expect(P.REGION_DEFAULT_VOICES).toEqual({
      bac: 'Hải Đăng',
      trung: 'Ngọc Trân',
      nam: 'Thái Sơn',
    });
  });
});

describe('rowStatus', () => {
  const done = { status: 'completed' };
  it('needs generation when the wake clip is missing but the utterance is done', () => {
    expect(P.rowStatus([undefined, done])).toEqual({ s: 'need' });
  });
  it('is ok only when every clip is completed', () => {
    expect(P.rowStatus([done, done])).toEqual({ s: 'ok' });
  });
  it('waits while a clip is queued, waiting or active', () => {
    for (const status of ['queued', 'waiting', 'active']) {
      expect(P.rowStatus([{ status }, done])).toEqual({ s: 'wait' });
    }
  });
  it('reports the first error', () => {
    expect(P.rowStatus([done, { status: 'failed', error: 'hỏng' }])).toEqual({
      s: 'err',
      error: 'hỏng',
    });
  });
  it('needs generation when nothing exists', () => {
    expect(P.rowStatus([undefined])).toEqual({ s: 'need' });
  });
});
