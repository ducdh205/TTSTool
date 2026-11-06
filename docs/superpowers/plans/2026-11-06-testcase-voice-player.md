# Testcase Voice Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang `/testcase.html` đọc Excel testcase, sinh giọng VieNeu theo vùng miền và phát từng câu / phát toàn bộ có khoảng nghỉ.

**Architecture:** Excel được đọc trên trình duyệt (SheetJS vendored + module thuần `testcase-parse.js`). Gateway thêm `POST /api/tts/batch`, `POST /api/tts/jobs/status` (dùng lại `TtsService.submit/status`) và `GET /api/testcases`. Trình duyệt khử trùng clip, gửi theo lô, poll trạng thái, phát bằng một `<audio>` dùng chung.

**Tech Stack:** NestJS 11, class-validator, BullMQ, Jest/supertest; vanilla JS + SheetJS 0.18.5.

**Spec:** `docs/superpowers/specs/2026-11-06-testcase-voice-player-design.md`

## Global Constraints

- Chạy mọi lệnh trong WSL: `wsl -d Ubuntu --exec bash -lc 'cd /mnt/e/ToolTTS/gateway && <cmd>'`. Commit bằng git trong WSL.
- Giữ Nest 11 majors; không thêm dependency npm mới cho gateway.
- Giọng mặc định: `bac` → `Hải Đăng`, `trung` → `Ngọc Trân`, `nam` → `Thái Sơn`.
- Mặc định: wake-word `Hey Vita`, nghỉ sau wake-word `1.0` s, nghỉ giữa testcase `3.0` s, tốc độ `1.0`, định dạng `mp3`.
- `MAX_BATCH = 200` item; status batch tối đa `500` id; throttle batch `10`/phút.
- `localStorage` key `vieneu.testcase`, luôn bọc try/catch.
- Text UI tiếng Việt. Sau mỗi task: `npx eslint src test && npx tsc --noEmit -p tsconfig.json && npm test` sạch.

## Review Focus

- Một item batch sai vùng/giọng không được làm fail cả lô → test trong Task 1.
- Câu nói trùng nhau trên nhiều dòng (cùng giọng) chỉ sinh một job → `clipKey` trong Task 3 + kiểm tra tay Task 5.
- Câu phủ định wake-word thực tế ("Không nói wake-word (câu gần âm)", "Không (sự kiện pin)", "Nút thoại vô-lăng (KQ Wake ghi N/A)") → test Task 3.
- Ô "Bước" chứa text dài (dòng lệch cột TC-F2-18) không làm hỏng parse → test Task 3.
- Tên file có dấu/khoảng trắng trong `public/testcase/` → URL `encodeURIComponent`, test Task 2.

---

### Task 1: Gateway batch submit + batch status

**Files:**
- Modify: `gateway/src/common/constants.ts` (thêm `MAX_BATCH = 200`, `MAX_STATUS_IDS = 500`)
- Create: `gateway/src/tts/batch.dto.ts`
- Modify: `gateway/src/tts/tts.service.ts`, `gateway/src/tts/tts.controller.ts`
- Test: `gateway/src/tts/tts.service.spec.ts` (mới), `gateway/test/tts.e2e-spec.ts`

**Interfaces:**
- Produces: `TtsService.submitMany(items: CreateTtsDto[]): Promise<JobView[]>`, `TtsService.statusMany(ids: string[]): Promise<JobView[]>`.
- HTTP: `POST /api/tts/batch` body `{items: CreateTtsDto[]}` → 200 `JobView[]`; `POST /api/tts/jobs/status` body `{ids: string[]}` → 200 `JobView[]`. Lỗi từng phần tử: `{ jobId: '' | id, status: 'failed', error: string }`.

- [ ] **Step 1: Viết test unit thất bại** `tts.service.spec.ts`: tạo `new TtsService(queue, cfg, cache, voices)` với stub rỗng (`{} as any`), `jest.spyOn(svc, 'submit')`:
  - `submitMany keeps order and isolates errors`: submit trả `{jobId:'a',status:'waiting'}`, rồi reject `new BadRequestException('Giọng X không thuộc vùng nam')`, rồi `{jobId:'c',status:'completed'}` → kết quả `[{jobId:'a',...}, {jobId:'',status:'failed',error:'Giọng X không thuộc vùng nam'}, {jobId:'c',...}]`.
  - `statusMany maps NotFound to failed`: spy `status` reject `NotFoundException('Job không tồn tại')` cho id `'f'.repeat(64)` → `[{jobId:'fff…',status:'failed',error:'Job không tồn tại'}]`.
- [ ] **Step 2:** `npx jest src/tts/tts.service.spec.ts` → FAIL (`submitMany is not a function`).
- [ ] **Step 3: Implement** `submitMany` (tuần tự `for…of`, bắt lỗi, `error = e instanceof HttpException ? message của response : String(e)`) và `statusMany` (song song `Promise.all`, bắt lỗi tương tự, `jobId` = id). DTO `CreateTtsBatchDto { @IsArray @ArrayMinSize(1) @ArrayMaxSize(MAX_BATCH) @ValidateNested({each:true}) @Type(() => CreateTtsDto) items }` và `JobStatusBatchDto { @IsArray @ArrayMinSize(1) @ArrayMaxSize(MAX_STATUS_IDS) @Matches(HASH_RE,{each:true}) ids }`. Controller: `@Post('batch') @HttpCode(200) @UseGuards(ThrottlerGuard) @Throttle({default:{limit:10,ttl:60_000}})` và `@Post('jobs/status') @HttpCode(200)`.
- [ ] **Step 4:** unit test PASS.
- [ ] **Step 5: E2E** trong `tts.e2e-spec.ts` thêm:
  - `POST /api/tts/batch` với `[{text:'một',region:'bac',voice:'Hải Đăng'}, {text:'hai',region:'nam',voice:'Hải Đăng'}, {text:'một',region:'bac',voice:'Hải Đăng'}]` → 200, `body.length===3`, `body[1].status==='failed'`, `body[0].jobId===body[2].jobId`; `waitDone(body[0].jobId).status==='completed'`.
  - `POST /api/tts/jobs/status` `{ids:[body[0].jobId, 'f'.repeat(64)]}` → `[completed, failed]`.
  - `POST /api/tts/batch {items:[]}` → 400; `{ids:['bad']}` → 400.
  Run `npm run test:e2e` → PASS (cần redis).
- [ ] **Step 6: Commit** `feat(gateway): batch submit and batch status endpoints`.

### Task 2: Gateway liệt kê file testcase

**Files:**
- Modify: `gateway/src/config/app.config.ts` (`testcaseDir: resolve(process.env.TESTCASE_DIR ?? join(__dirname, '..', '..', 'public', 'testcase'))`)
- Create: `gateway/src/testcases/testcases.controller.ts`, `gateway/src/testcases/testcases.module.ts`
- Modify: `gateway/src/app.module.ts` (import `TestcasesModule`), `.gitignore` (`gateway/public/testcase/*.xlsx`), `gateway/.env.example` (`# TESTCASE_DIR=`)
- Test: `gateway/test/tts.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/testcases` → `{ name: string; size: number; mtime: string /*ISO*/; url: string }[]`, `url = '/testcase/' + encodeURIComponent(name)`, sort theo `name` (`localeCompare('vi')`), chỉ file `*.xlsx` (không phân biệt hoa thường, bỏ file bắt đầu `~$`). Thư mục không có → `[]`.

- [ ] **Step 1: E2E thất bại:** trước khi compile module, `process.env.TESTCASE_DIR = mkdtempSync(...)` và ghi `Bộ test 1.xlsx`, `~$lock.xlsx`, `note.txt`. Test `GET /api/testcases` → `[{name:'Bộ test 1.xlsx', url:'/testcase/B%E1%BB%99%20test%201.xlsx', size: <số byte đã ghi>, mtime: expect.any(String)}]`.
- [ ] **Step 2:** `npm run test:e2e -t testcases` → FAIL 404.
- [ ] **Step 3: Implement** controller dùng `fs/promises.readdir(dir, {withFileTypes:true})` + `stat`, bắt `ENOENT` → `[]`.
- [ ] **Step 4:** e2e PASS; lint/tsc/test sạch.
- [ ] **Step 5: Commit** `feat(gateway): list testcase workbooks`.

### Task 3: Module đọc testcase `testcase-parse.js`

**Files:**
- Create: `gateway/public/testcase-parse.js`
- Test: `gateway/src/testcases/testcase-parse.spec.ts` (`const P = require('../../public/testcase-parse.js')`; kèm `// eslint-disable-next-line @typescript-eslint/no-require-imports` nếu cần)

**Interfaces (UMD: `module.exports` khi có `module`, ngược lại `window.TestcaseParse`):**
- `findHeader(rows: unknown[][]): { headerIndex: number; cols: { tcId, title, region, step, precondition, speaker, utterance, expected: number /* -1 nếu thiếu */ } } | null` — quét 15 dòng đầu, khớp chuỗi con sau `normalize('NFC')`: `TC_ID`, `Tiêu đề`, `Vùng miền`, `Bước`, `Tiền điều kiện`, `Người nói`, `Câu nói`, `Kết quả mong đợi`. Bắt buộc có `Câu nói` và `Vùng miền`.
- `mapRegion(raw: unknown): { region: 'bac'|'trung'|'nam'; warning?: string }`
- `wakeWordWanted(step: number, precondition: unknown): boolean`
- `isSpeech(speaker: unknown): boolean`
- `parseSheet(rows: unknown[][]): Row[] | null`, `Row = { index, tcId, step, title, regionRaw, region, speaker, utterance, expected, wakeWord, speech, warnings: string[] }` (`index` = số dòng Excel, 1-based).
- `clipKey(voice: string, text: string): string` = `voice.normalize('NFC') + '|' + text.normalize('NFC').trim().replace(/\s+/g,' ')`.
- `REGION_DEFAULT_VOICES = { bac: 'Hải Đăng', trung: 'Ngọc Trân', nam: 'Thái Sơn' }`.

- [ ] **Step 1: Viết test thất bại**, các assertion:
  - `mapRegion('BAC-HN')→{region:'bac'}`, `('bac_hn')→bac`, `('TRUNG-HUE')→trung`, `('TRUNG-NA')→{region:'trung'}`, `('NAM-HCM / TRUNG-HUE')→{region:'nam', warning:'Nhiều vùng, dùng NAM-HCM'}`, `(null)` và `('1.0')` → `{region:'bac', warning: 'Vùng không nhận ra: <raw hoặc trống>'}` (kiểm tra `warning` khớp `/^Vùng không nhận ra/`).
  - `wakeWordWanted(1,'...\nWake-word: Hey Vita\n...')===true`; `(2, 'Wake-word: Hey Vita')===false`; `false` cho mỗi giá trị: `Không nói wake-word`, `Không nói wake-word (câu gần âm)`, `Không cần`, `Không gọi`, `Không (sự kiện pin)`, `Nút thoại vô-lăng (KQ Wake ghi N/A)`; `true` khi không có dòng `Wake-word:`; `true` cho `Vita ơi`.
  - `isSpeech('👤 Người dùng')===true`, `('👤 Hành khách TP')===true`; `false` cho `— (không có lời nói)`, `🔧 Tester (thao tác)`, `⚙️ Giả lập HIL/CAN`, `📻 Loa media`.
  - `findHeader`: mảng 3 dòng rác + dòng tiêu đề như file thật (`['TC_ID','Cụm tính năng','Use case / Req ID','Tiêu đề test case','Mức ưu tiên','Loại test','Mã lĩnh vực KT (A–V)','Vùng miền','Bước / Lượt','Tiền điều kiện & môi trường','Các bước thực hiện','Người nói','Câu nói (utterance)','Kết quả mong đợi']`) → `headerIndex:3, cols.utterance:12, cols.region:7, cols.step:8`; mảng không có cột → `null`.
  - `parseSheet`: 5 dòng dữ liệu — dòng thường; dòng Bước 2; dòng câu nói trống (bị bỏ); dòng Tester; dòng `Bước` = chuỗi dài 'Trạng thái hệ thống: ...' → kết quả 4 row; row lệch có `step:1` và warning `'Bước không hợp lệ'`; row Tester `speech:false`; row Bước 2 `wakeWord:false`; `index` dòng đầu = 5. Câu nói 3001 ký tự → `speech:false`, warning `'Câu nói quá 3000 ký tự'`.
  - `clipKey('Hải Đăng','  Mở   kính ')==='Hải Đăng|Mở kính'`.
- [ ] **Step 2:** `npx jest src/testcases/testcase-parse.spec.ts` → FAIL (cannot find module).
- [ ] **Step 3: Implement** theo các chữ ký trên. `wakeWordWanted`: lấy giá trị sau `/Wake-word:\s*([^\n]*)/`; false khi bắt đầu bằng `Không` hoặc chứa `Nút thoại`. `step` = `Number(raw)`; không phải số hữu hạn → 1 + warning.
- [ ] **Step 4:** test PASS; lint/tsc sạch.
- [ ] **Step 5: Commit** `feat(ui): testcase sheet parser`.

### Task 4: Trang testcase — nạp file, bảng, cài đặt giọng, nghe thử

**Files:**
- Create: `gateway/public/vendor/xlsx.full.min.js` (tải `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`), `gateway/public/testcase.html`, `gateway/public/testcase.js`
- Modify: `gateway/public/style.css` (bảng, `.row-muted`, `.row-playing`, `.warn`, khung bảng `overflow-x:auto`), `gateway/public/index.html` (link "Testcase →" ở header)

**Interfaces:**
- Consumes: `TestcaseParse.*` (Task 3), `GET /api/voices`, `GET /api/testcases` (Task 2), `POST /api/tts/batch`, `POST /api/tts/jobs/status` (Task 1).
- Produces trong `testcase.js` (IIFE, dùng ở Task 5): `state = { settings, voices, workbook, rows, overrides: Map<index,{voice?,wakeWord?}>, clips: Map<clipKey,{jobId?, status, audioUrl?, error?}> }`; `effectiveVoice(row)`, `wantsWake(row)`, `regionOfVoice(name)`; `ensureClips(list: {voice,text}[]): Promise<void>` (gửi lô ≤200 các clip chưa `completed`, poll status 1.5 s tới khi xong, gọi `render()` sau mỗi lần poll); `playClip(url): Promise<void>`; `render()`.

- [ ] **Step 1:** HTML 5 khối theo spec §3.2 (Nguồn dữ liệu, Thiết lập, Giọng theo vùng + `<details>` "Xem tất cả giọng", Điều khiển, Bảng). Script order: `vendor/xlsx.full.min.js`, `testcase-parse.js`, `testcase.js`.
- [ ] **Step 2:** `testcase.js` phần nạp: dropdown mở nhanh từ `/api/testcases` (fetch `url` → `arrayBuffer` → `XLSX.read(buf,{type:'array'})`), input file; dropdown sheet chỉ gồm sheet `parseSheet` ≠ null; chọn sheet → `state.rows`; tóm tắt "N dòng · M cần đọc · K ⚠".
- [ ] **Step 3:** settings load/save `localStorage['vieneu.testcase']` (giá trị mặc định theo Global Constraints; giọng mặc định lấy `REGION_DEFAULT_VOICES`, nếu giọng không có trong `/api/voices` thì dùng giọng đầu tiên của vùng). Ba dropdown giọng theo vùng + nút ▶; danh sách tất cả giọng nhóm theo vùng (tên, giới tính, phong cách, ▶).
- [ ] **Step 4:** render bảng: cột `# · TC_ID · Bước · Vùng (Excel) · Giọng (select) · WW (checkbox) · Câu nói (title = Tiêu đề + '\n' + Kết quả mong đợi) · Trạng thái · ▶`; dòng `speech:false` thêm `.row-muted`, không có select/checkbox/▶; warnings hiện `⚠` với `title`. Sửa select/checkbox ghi vào `overrides`.
- [ ] **Step 5:** `ensureClips` + `playClip` + nghe thử: clip `"<wakeWord>, xin chào, đây là giọng <tên>."` (bỏ phần wake-word khi trống), `ensureClips([clip])` rồi `playClip`. Lỗi API hiện ở khối tương ứng; `/api/voices` lỗi → khoá nút Sinh giọng.
- [ ] **Step 6: Kiểm tra tay:** `npm run build && node dist/main` (cùng tts-service), mở `http://localhost:3000/testcase.html`, mở nhanh `Testcases.xlsx`: dropdown sheet có 24 sheet; sheet "ĐóngMở cửa kính" hiện 104 dòng, TC-F1-06 có ⚠ "Nhiều vùng"; nghe thử Ngọc Trân phát được; F5 giữ cài đặt.
- [ ] **Step 7: Commit** `feat(ui): testcase page with workbook loading and voice settings`.

### Task 5: Sinh giọng hàng loạt và phát

**Files:**
- Modify: `gateway/public/testcase.js`, `gateway/public/testcase.html`, `gateway/public/style.css`

**Interfaces:**
- Consumes: Task 4 (`ensureClips`, `playClip`, `effectiveVoice`, `wantsWake`, `render`), `clipKey` (Task 3).

- [ ] **Step 1: Sinh giọng:** nút "Sinh giọng (n)" (n = số dòng speech có clip chưa completed). Tập clip = với mỗi dòng speech `{voice: effectiveVoice(row), text: utterance}`, cộng `{voice, text: wakeWord}` cho mỗi giọng có ít nhất một dòng `wantsWake`. Thanh tiến độ "x/y · z lỗi". Trạng thái dòng: ✗ nếu có clip failed (lý do trong `title`, nút "Thử lại" gọi `ensureClips` cho clip đó), ⏳ nếu chưa xong, ✓ nếu xong hết, "cần sinh" nếu chưa có job.
- [ ] **Step 2: Phát 1 dòng:** `[playClip(wake) → wait(gapAfterWake)] → playClip(utterance)`; clip chưa có thì gọi `ensureClips` trước.
- [ ] **Step 3: Phát toàn bộ:** từ ô "Bắt đầu từ dòng" (số `#`), lần lượt các dòng speech có đủ clip, `wait(gapBetween)` giữa dòng; dòng thiếu/lỗi → bỏ qua, thêm vào log trên bảng. Dừng tạm (`audio.pause()`, tạm dừng `wait`), Tiếp tục, Huỷ (huỷ `wait` + dừng audio). Dòng đang phát `.row-playing` + `scrollIntoView({block:'center'})`. `playClip` reject (audio hết hạn) → xoá clip khỏi `state.clips` (về "cần sinh") và bỏ qua dòng.
- [ ] **Step 4:** Đổi wake-word/tốc độ/định dạng → clip key đổi (đưa `speed`, `format` vào key Map: `clipKey(voice,text) + '|' + speed + '|' + format`), `render()` để dòng về "cần sinh".
- [ ] **Step 5: Kiểm tra tay** với sheet "BậtTắt Ion" (28 dòng): Sinh giọng hoàn tất không lỗi; phát dòng IO-0001 nghe "Hey Vita" → ~1 s → câu nói; Phát toàn bộ nghỉ ~3 s giữa dòng, Dừng/Tiếp tục/Huỷ hoạt động; đổi giọng Trung → dòng TRUNG-HUE về "cần sinh", dòng khác vẫn ✓.
- [ ] **Step 6:** `npx eslint src test && npx tsc --noEmit -p tsconfig.json && npm test && npm run test:e2e` sạch. Cập nhật `README.md` (mục "Trang Testcase": cách dùng, thư mục `public/testcase/`) và `CLAUDE.md` (endpoint batch, `TESTCASE_DIR`, `testcase-parse.js` dùng chung cho Jest).
- [ ] **Step 7: Commit + push** `feat(ui): batch generation and sequential playback for testcases`.
