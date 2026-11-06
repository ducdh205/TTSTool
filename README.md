# ToolTTS: Hệ thống TTS tiếng Việt với VieNeu

Gồm 3 phần:

| Thành phần | Công nghệ | Port | Vai trò |
|---|---|---|---|
| `tts-service/` | Python 3.12, FastAPI, [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) v3 Turbo (ONNX int8, CPU) | 8001 (chỉ 127.0.0.1) | Nạp model, sinh giọng, chỉnh tốc độ (ffmpeg `atempo`), encode mp3/wav |
| `gateway/` | NestJS 11, BullMQ, Redis | 3000 | API public: vùng/giọng/tốc độ, xếp hàng job, cache audio, phục vụ UI |
| `gateway/public/` | HTML/CSS/JS thuần | 3000 | Giao diện web |

```
Trình duyệt ─► gateway :3000 ─► BullMQ (Redis) ─► worker ─► tts-service :8001 ─► VieNeu
                    └─ cache: metadata trong Redis (TTL) + file trên đĩa (gateway/storage/audio)
```

## Cài đặt (WSL Ubuntu)

```bash
sudo apt install -y redis-server ffmpeg
curl -LsSf https://astral.sh/uv/install.sh | sh        # uv
source scripts/env.sh                                  # venv ở ~/.venvs/tts-service (nhanh hơn /mnt/e)
(cd tts-service && uv sync --python 3.12)
(cd gateway && npm install)
cp tts-service/.env.example tts-service/.env
cp gateway/.env.example gateway/.env
# Đặt INTERNAL_API_KEY giống nhau trong hai file .env
```

Lần chạy đầu tiên, tts-service sẽ tải model từ HuggingFace (vài trăm MB, lưu tại `~/.cache/huggingface`).

## Chạy

```bash
./scripts/dev.sh          # khởi động redis (nếu cần), tts-service và gateway
```

Sau đó mở http://localhost:3000.

## API của gateway

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/regions` | `[{id: 'bac'\|'trung'\|'nam'\|'khac', label}]` |
| GET | `/api/voices?region=bac` | Danh sách giọng (`id, name, region, gender, style, isDefault`) |
| POST | `/api/tts` | Body `{text, region, voice, speed?=1 (0.5–2), format?='mp3'\|'wav'}`. Trả **200** kèm `audioUrl` nếu có sẵn trong cache, hoặc **202** kèm `jobId` nếu đã xếp hàng |
| GET | `/api/tts/jobs/:jobId` | `{status: waiting\|active\|completed\|failed, position, progress, audioUrl, duration, cached, error}` |
| GET | `/api/audio/:hash.:ext` | File audio, có hỗ trợ Range |

Cách gateway xử lý một request:
- Giọng phải thuộc đúng vùng đã chọn, nếu không sẽ trả 400.
- Khoá cache là `sha256(modelTag, text đã chuẩn hoá NFC + gộp khoảng trắng, voice, speed làm tròn 0.05, format)`. `jobId` chính là khoá cache, nên các request giống nhau đang chạy dồn chung vào một job.
- Queue chạy với concurrency 1, vì trên CPU chỉ nên sinh một câu tại một thời điểm. Job lỗi được retry 1 lần; lỗi 4xx từ tts-service thì không retry.
- Cache sống `CACHE_TTL_DAYS` ngày (mặc định 7). Cứ 6 giờ có một tác vụ dọn file đã hết hạn.
- Giới hạn tần suất: tối đa 20 lần `POST /api/tts` mỗi phút cho mỗi IP.

## API nội bộ của tts-service

Mọi endpoint (trừ `/health`) đều cần header `X-Internal-Key`.

- `GET /health`
- `GET /voices`
- `POST /synthesize` với body `{text, voice, speed, format}`, trả audio bytes kèm header `X-Audio-Duration`.

VieNeu v3 Turbo không có tham số tốc độ, nên tốc độ được chỉnh bằng time-stretch giữ nguyên cao độ.

## Test

```bash
(source scripts/env.sh && cd tts-service && uv run pytest)
(cd gateway && npm test && npm run test:e2e)   # e2e cần redis-server đang chạy (dùng db 15)
```

## Ghi chú

- VieNeu v3 Turbo dùng giấy phép Apache-2.0 và mặc định gắn watermark vào audio.
- int8 trên CPU cần VNNI (AVX-512 VNNI hoặc AVX-VNNI). Nếu CPU không hỗ trợ, đặt `VIENEU_PRECISION=fp32`.
