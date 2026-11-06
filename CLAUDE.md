# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

- Everything runs in **WSL Ubuntu**. The repo lives on the Windows drive (`E:\ToolTTS` = `/mnt/e/ToolTTS`), but the Python venv is on the Linux FS at `~/.venvs/tts-service`. `source scripts/env.sh` sets `UV_PROJECT_ENVIRONMENT`, `PATH` (uv) and `ROOT_DIR`; always source it before `uv` commands or uv will create a slow `.venv` on `/mnt/e`.
- From a Windows shell, use `wsl -d Ubuntu --exec bash -lc '...'`. Without `--exec`, the user's login shell (zsh) expands `$VARS` first. PowerShell 5.1 also strips inner double quotes and mangles `|` inside quoted regexes, so put anything non-trivial in a script file and run `wsl -d Ubuntu --exec bash /mnt/c/.../script.sh`.
- Requires `redis-server` and `ffmpeg` (apt). Git pushes to `git@github.com:ducdh205/TTSTool.git` via the WSL SSH key.

## Commands

```bash
./scripts/dev.sh                                   # redis check + tts-service :8001 + gateway (watch) :3000, UI at /
source scripts/env.sh && cd tts-service
uv sync --python 3.12                              # vieneu supports <=3.13; system python is 3.14
uv run --no-sync pytest -q                         # all Python tests
uv run --no-sync pytest tests/test_api.py::test_voices -q   # single test
uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8001
cd gateway
npm test                                           # unit (src/**/*.spec.ts)
npx jest src/cache/cache-key.spec.ts -t 'rounds'   # single test
npm run test:e2e                                   # needs redis on :6379, uses db 15, mocks tts-service
npx eslint src test && npx tsc --noEmit -p tsconfig.json
npm run build && node dist/main                    # faster start than `nest start --watch` on /mnt/e
```

## Architecture

Request flow: browser → **gateway** (NestJS, `/api` prefix, also serves `gateway/public/` static UI) → BullMQ queue `tts` in Redis → `TtsProcessor` worker (same process) → **tts-service** (FastAPI, bound to 127.0.0.1, every route except `/health` requires the `X-Internal-Key` header, which must match `INTERNAL_API_KEY` in both `.env` files) → VieNeu SDK.

Gateway (`gateway/src`):
- **Cache key = job id.** `tts.service.ts` computes `sha256(modelTag, normalizeText(text), NFC voice, roundSpeed(speed) to 0.05, format)` (`cache/cache-key.ts`) and uses it as both the BullMQ `jobId` and the audio file name. Identical in-flight requests therefore collapse onto one job. A finished or failed job with that id must be removed before it can be re-added, and `submit()` handles that.
- **Cache storage is split:** the audio file lives at `AUDIO_DIR/<hash>.<ext>`, and the metadata lives in Redis `tts:cache:<hash>` with a TTL. An entry is valid only if both exist (`AudioCacheService.get`). Periodic `cleanup()` deletes files whose Redis key has expired, but skips files younger than 10 minutes because `put()` renames the file before it writes the key.
- **Region validation:** `VoicesService` memoizes `GET /voices` from tts-service for 10 minutes and enforces that the voice belongs to the requested region (400 otherwise).
- **Retries:** `TtsServiceError` with a 4xx status becomes `UnrecoverableError`, so BullMQ does not retry it. 5xx or network errors are retried once.
- **Concurrency:** worker concurrency (`QUEUE_CONCURRENCY`, default 1, which is right for CPU inference) is set in `onApplicationBootstrap`, because the worker does not exist yet during `onModuleInit`.
- **Static limits:** `MAX_TEXT_LEN`, the speed range and the regions are static in `common/constants.ts`, since DTO decorators need them at import time. They are duplicated in `public/index.html` and `tts-service` (`MAX_CHARS`, `audio.py`), so keep them in sync by hand.
- **Version pins:** stay on Nest 11 majors (`@nestjs/serve-static@5`, `config@4`, `bullmq@11`, `throttler@6`). Newer majors require Nest 12.

tts-service (`tts-service/app`):
- `engine.py` wraps `vieneu.Vieneu(mode="v3turbo", device="cpu", precision="int8")`. It loads lazily in the FastAPI lifespan and serializes `infer` with a lock. `infer()` returns 48 kHz float32 and chunks long text internally.
- `_patch_onnx_fetch` monkeypatches the SDK's private `OnnxV3LiteEngine._fetch` to hardlink HF-cache files into `MODELS_DIR` (`~/.cache/tooltts/models`). ONNX Runtime ≥1.31 refuses external `.data` files reached through HF snapshot symlinks. Re-check this patch when upgrading `vieneu`.
- VieNeu v3 Turbo has **no speed parameter**. Speed is applied after inference with ffmpeg `atempo` in `audio.py`. WAV is produced as raw s16le from ffmpeg and wrapped with Python `wave`, because ffmpeg cannot write correct WAV header sizes to a pipe.
- Voice region, gender and style are parsed from SDK descriptions such as `"Nữ · Bắc · Phong cách tin tức"` (`voices.py`). `data/voice_regions.json` is only a fallback. Voice aliases resolve via the SDK's `resolve_voice_name`.
- Tests inject a fake SDK object via `TtsEngine(settings, tts=fake)`, so they never load the real model.

If `VIENEU_MODE`, `VIENEU_PRECISION` or `MP3_BITRATE` changes, bump `MODEL_TAG` in `gateway/.env`, otherwise stale cached audio is served.
