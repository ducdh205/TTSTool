# Testcase Voice Player — Thiết kế

Ngày: 2026-11-06 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Tool phát giọng nói cho test E2E voice assistant trên xe. Người test nạp file Excel testcase, tool đọc câu nói (utterance) và vùng miền của từng testcase, sinh giọng đọc bằng VieNeu local theo giọng mặc định của vùng, rồi phát từng câu hoặc phát toàn bộ lần lượt có khoảng nghỉ — thay cho việc người thật đọc.

**Thành công khi:** mở file `Testcases.xlsx` hiện có, chọn một sheet, bấm "Sinh giọng" rồi "Phát toàn bộ" là nghe lần lượt "wake-word → nghỉ → câu nói → nghỉ → testcase kế tiếp" đúng giọng vùng miền, không phải sửa file Excel.

### Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Chỉ dùng model local VieNeu v3 Turbo (không dùng Cloud API). Thành Sen / Nhật Phong / Anh Khang **không có** ở local (chỉ có trên api.vieneu.io). |
| D2 | Giọng mặc định: Bắc → **Hải Đăng**, Trung → **Ngọc Trân**, Nam → **Thái Sơn**; đổi được trong UI. |
| D3 | Wake-word chỉ gắn ở **Bước 1**, và **không** gắn nếu cột Tiền điều kiện ghi rõ không gọi wake-word. Mỗi dòng có checkbox WW để ghi đè. |
| D4 | Dòng có Người nói không phải lời nói (Tester thao tác, không có lời nói, HIL/CAN, Loa media) hiện xám, không sinh, không phát. |
| D5 | Vùng lạ: `A / B` → lấy vùng đầu; `TRUNG-NA` → Trung; trống/không nhận ra → Bắc + ⚠. Giọng từng dòng sửa tay được. |
| D6 | Wake-word và câu nói là **2 audio riêng**, phát cách nhau "nghỉ sau wake-word" (mặc định 1.0 s). Nghỉ giữa testcase mặc định 3.0 s. |
| D7 | Đọc Excel **trên trình duyệt** bằng SheetJS (vendored). Gateway thêm endpoint batch. |
| D8 | Có dropdown "Mở nhanh" các file `.xlsx` trong `gateway/public/testcase/`, ngoài nút chọn file. File `.xlsx` thật **không** commit (gitignore). |

## 2. Dữ liệu đầu vào (khảo sát `Testcases.xlsx`)

- 31 sheet; 24 sheet testcase có tiêu đề ở dòng 4 (dòng 1–3 là tiêu đề/ghi chú/nhóm cột). 7 sheet phụ (Rule, CauHoiMo, NhomChuDe, MoHinhPhu, PhuCap, NhatKyDuyet, LogChayRule) không có cột cần thiết.
- Cột liên quan (tìm theo tên, không theo vị trí): `TC_ID`, `Tiêu đề test case`, `Vùng miền`, `Bước / Lượt`, `Tiền điều kiện & môi trường`, `Người nói`, `Câu nói (utterance)`, `Kết quả mong đợi`.
- ~2.000 dòng có câu nói. Vùng: `BAC-HN` 1494, `NAM-HCM` 173, `TRUNG-HUE` 168, `NAM-HCM / TRUNG-HUE` 4, `TRUNG-NA` 2, trống 3, lệch cột 1.
- Wake-word ghi trong Tiền điều kiện, dòng `Wake-word: ...`: "Hey Vita" 1513, "Vita ơi" 6, các biến thể phủ định ("Không nói wake-word", "Không cần", "Không gọi", "Không (sự kiện …)", "Nút thoại vô-lăng …") ~50, không ghi ~260.
- Testcase đa lượt: cùng `TC_ID`, `Bước` 1..8.

## 3. Kiến trúc

```
testcase.html ──SheetJS──> testcase-parse.js ──rows──> testcase.js (state, UI, player)
                                                          │  POST /api/tts/batch
                                                          │  POST /api/tts/jobs/status
                                                          │  GET  /api/testcases
                                                          ▼
                                   gateway (TtsService.submit/status, queue, cache — có sẵn)
```

### 3.1 Gateway (thay đổi)

**`POST /api/tts/batch`** — `TtsController`
- Body: `{ items: CreateTtsDto[] }`, 1..200 item (`@ValidateNested`, `@ArrayMinSize(1)`, `@ArrayMaxSize(200)`; hằng `MAX_BATCH = 200` trong `common/constants.ts`).
- Gọi `TtsService.submit()` tuần tự cho từng item. Lỗi của một item (vd. `BadRequestException` giọng sai vùng) được bắt và trả `{ jobId: '', status: 'failed', error }` tại vị trí đó; không làm fail cả request.
- Response 200: `JobView[]` cùng thứ tự với `items`.
- Throttle riêng: 10 request/phút.

**`POST /api/tts/jobs/status`**
- Body: `{ ids: string[] }`, 1..500 id dạng hash (`@Matches(HASH_RE, {each:true})`).
- Trả `JobView[]` cùng thứ tự; id không tồn tại → `{ jobId, status: 'failed', error: 'Job không tồn tại' }`.
- Không throttle (giống `GET /tts/jobs/:id`).

**`GET /api/testcases`** — controller mới `TestcasesController` (module `testcases`)
- Liệt kê `*.xlsx` trong `<public>/testcase/` (không đệ quy), trả `[{ name, size, mtime, url: '/testcase/<encodeURIComponent(name)>' }]`, sắp theo tên. Thư mục không tồn tại → `[]`.
- File tải bằng static serving sẵn có.

**Khác:** `.gitignore` thêm `gateway/public/testcase/*.xlsx`. Trang `index.html` thêm link "Testcase →".

### 3.2 Trình duyệt

**`public/vendor/xlsx.full.min.js`** — SheetJS 0.18.5 (Apache-2.0), commit vào repo, dùng offline.

**`public/testcase-parse.js`** — module thuần (UMD: `window.TestcaseParse` và `module.exports` cho Jest), không đụng DOM.
- `findHeader(rows)`: dòng đầu tiên (trong 15 dòng đầu) có ô chứa "Câu nói" và ô chứa "Vùng miền" (so sánh sau NFC + bỏ khoảng trắng thừa). Trả `{ headerIndex, cols }` hoặc `null`.
- `mapRegion(raw)`: `→ { region: 'bac'|'trung'|'nam', warning? }`. Lấy phần trước `/` đầu tiên; tiền tố `BAC` → bac, `TRUNG` → trung, `NAM` → nam (không phân biệt hoa thường, chấp nhận `-`/`_`). Không khớp → `bac` + warning "Vùng không nhận ra: <raw>". Có `/` → warning "Nhiều vùng, dùng <vùng đầu>".
- `wakeWordWanted(step, precondition)`: `false` nếu step > 1; `false` nếu dòng `Wake-word:` trong tiền điều kiện bắt đầu bằng "Không" hoặc chứa "Nút thoại"; ngược lại `true`.
- `isSpeech(speaker)`: `false` nếu Người nói chứa "không có lời nói", "Tester", "Giả lập", "HIL", "Loa media"; ngược lại `true`.
- `parseSheet(rows)` (rows = mảng 2 chiều từ `XLSX.utils.sheet_to_json(ws, {header:1, raw:false})`): bỏ dòng có câu nói trống; trả `Row[]`:
  `{ index, tcId, step, title, regionRaw, region, speaker, utterance, expected, wakeWord: bool, speech: bool, warnings: string[] }`.
  `step` không phải số (lệch cột) → step = 1 + warning "Bước không hợp lệ". Câu nói > 3000 ký tự → `speech=false` + warning.
- `listSheets(workbook)`: các sheet có `findHeader` ≠ null.

**`public/testcase.js`** — state + render + player.
- State: `settings` (wakeWord, gapAfterWake, gapBetween, speed, format, voiceByRegion, sheet) lưu `localStorage['vieneu.testcase']` (try/catch); `rows`; `overrides` theo `index` (voice, wakeWord) không lưu.
- Giọng hiệu lực của dòng = `override.voice ?? voiceByRegion[row.region]`; region gửi lên gateway = region của giọng đó (lấy từ `/api/voices`).
- **Sinh giọng:** tập "clip" cần có = mỗi dòng speech → `{text: utterance, voice}`; mỗi giọng dùng ở dòng có WW → `{text: wakeWord, voice}`. Khử trùng theo `voice|text`, gửi theo lô ≤ 200 tới `/tts/batch`, lưu `jobId` theo clip. Poll `/tts/jobs/status` mỗi 1.5 s cho các clip chưa xong tới khi hết. Trạng thái dòng = tổng hợp trạng thái clip của nó (⏳ / ✓ / ✗ + lý do). Nút "Thử lại" trên dòng lỗi gửi lại clip đó.
- Đổi wake-word / tốc độ / định dạng / giọng → clip key đổi → dòng về "cần sinh"; clip cũ vẫn dùng được nếu key trùng.
- **Player:** một `<audio>` dùng chung, hàm `playClip(url)` trả Promise kết thúc khi `ended` (reject khi `error`), `wait(ms)` có thể huỷ.
  - Phát 1 dòng: [wake clip → wait(gapAfterWake)] → utterance clip.
  - Phát toàn bộ: từ dòng "Bắt đầu từ" tới cuối, bỏ dòng không speech / chưa có audio / lỗi (ghi log), giữa các dòng `wait(gapBetween)`. Dừng tạm (pause tại chỗ), Tiếp tục, Huỷ. Dòng đang phát được highlight + `scrollIntoView`.
  - `error` khi phát (audio hết hạn cache) → dòng chuyển "cần sinh", phát toàn bộ bỏ qua dòng đó.
- **Nghe thử giọng:** clip `"<wakeWord>, xin chào, đây là giọng <tên>."` (wake-word trống → bỏ phần đầu), sinh qua `/tts/batch` 1 item rồi phát.
- **Danh sách giọng:** khối "Xem tất cả giọng" liệt kê `/api/voices` nhóm theo vùng, mỗi giọng hiện tên, giới tính, phong cách, nút ▶.

**`public/testcase.html`** — bố cục theo 5 khối: Nguồn dữ liệu, Thiết lập, Giọng theo vùng, Điều khiển, Bảng testcase (cột `# · TC_ID · Bước · Vùng (Excel) · Giọng · WW · Câu nói · Trạng thái/▶`). Tooltip câu nói = Tiêu đề + Kết quả mong đợi. Dùng lại `style.css` (thêm style bảng/hàng xám/highlight), responsive tới 360 px (bảng cuộn ngang trong khung).

## 4. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| File không đọc được | Thông báo lỗi ở khối Nguồn dữ liệu |
| Không sheet nào có 2 cột cần thiết | Thông báo "Không tìm thấy cột Câu nói / Vùng miền" |
| Vùng lạ / bước lệch / câu quá dài | ⚠ với lý do trên dòng (câu quá dài: không sinh) |
| Batch item lỗi validate, job failed, mất mạng | Dòng ✗ + lý do + "Thử lại"; phát toàn bộ bỏ qua và ghi log |
| Audio hết hạn khi phát | Dòng về "cần sinh", bỏ qua |
| Wake-word trống | Không dòng nào có wake-word |
| `/api/voices` lỗi | Thông báo; khoá nút Sinh giọng |

## 5. Kiểm thử

- **Jest unit** `gateway/src/testcases/testcase-parse.spec.ts` import `public/testcase-parse.js`: `findHeader`, `mapRegion` (`BAC-HN`, `NAM-HCM / TRUNG-HUE`, `TRUNG-NA`, `bac_hn`, trống, `1.0`), `wakeWordWanted` (bước 2, các câu phủ định thực tế, "Hey Vita"), `isSpeech`, `parseSheet` trên mảng 2 chiều nhỏ dựng tay.
- **Jest unit** batch trong `tts.service`/controller: thứ tự giữ nguyên, item lỗi không phá lô.
- **E2E** (`test/tts.e2e-spec.ts`, Redis thật + tts-service giả): `POST /api/tts/batch` (2 item hợp lệ + 1 sai vùng), `POST /api/tts/jobs/status`, `GET /api/testcases` (thư mục tạm có 1 file `.xlsx`).
- **Thủ công**: mở `/testcase.html` với `Testcases.xlsx` thật, sinh + phát toàn bộ sheet "BậtTắt Ion" (28 dòng), kiểm tra wake-word/khoảng nghỉ/giọng vùng, dừng/tiếp tục, đổi giọng vùng.
- `npx eslint src test`, `npx tsc --noEmit`, `npm test`, `npm run test:e2e` đều pass.

## 6. Ngoài phạm vi

Cloud API VieNeu; ghi kết quả test ngược vào Excel; xuất file audio ghép cả sheet; lưu chỉnh tay từng dòng; đọc định dạng `.xls`/`.csv`.
