"""Thin, thread-safe wrapper around the VieNeu SDK (v3 Turbo by default)."""

import logging
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from .audio import AudioFormat, EncodedAudio, apply_speed_and_encode
from .config import Settings
from .voices import Voice, build_voices

log = logging.getLogger("tts-service.engine")


class UnknownVoiceError(ValueError):
    pass


def _patch_onnx_fetch(models_dir: Path) -> None:
    """Make VieNeu's ONNX engine load graphs from real files in one directory.

    The SDK points ONNX Runtime at HF-cache snapshot paths, which are symlinks into
    `blobs/`. ORT >= 1.31 validates that a graph's external data (`*.data`) resolves
    inside the graph's directory and rejects the symlinked layout ("External data path
    escapes model directory"). We keep using the HF cache for downloading, then
    hardlink (or copy) each file into models_dir/<repo>/<subfolder>/.
    """
    from huggingface_hub import hf_hub_download
    from vieneu._v3_turbo_engine import onnx_runtime_lite as lite

    def fetch(repo: str, files: list[str], subfolder: str | None) -> Path:
        target = models_dir / repo.replace("/", "__") / (subfolder or "")
        target.mkdir(parents=True, exist_ok=True)
        for fn in files:
            dst = target / fn
            if dst.exists():
                continue
            try:
                src = Path(hf_hub_download(repo, fn, repo_type="model", subfolder=subfolder or None)).resolve()
            except Exception:
                if fn.endswith(".json"):
                    continue  # optional meta, same as the SDK
                raise
            tmp = dst.with_name(dst.name + ".tmp")
            tmp.unlink(missing_ok=True)
            try:
                os.link(src, tmp)
            except OSError:
                shutil.copy2(src, tmp)
            tmp.replace(dst)
        return target

    lite.OnnxV3LiteEngine._fetch = staticmethod(fetch)


class TtsEngine:
    def __init__(self, settings: Settings, tts: Any = None):
        """`tts` can be injected (tests); otherwise it is created in `load()`."""
        self.settings = settings
        self._tts = tts
        # ONNX/CPU runs one synthesis at a time efficiently; parallel calls only fight for cores.
        self._lock = threading.Lock()
        self._voices: list[Voice] | None = None

    @property
    def ready(self) -> bool:
        return self._tts is not None

    def info(self) -> dict:
        return {
            "mode": self.settings.vieneu_mode,
            "device": self.settings.vieneu_device,
            "precision": self.settings.vieneu_precision,
            "backend": getattr(self._tts, "backend", None),
            "sampleRate": getattr(self._tts, "sample_rate", None),
        }

    def load(self) -> None:
        if self._tts is None:
            from vieneu import Vieneu  # heavy import, keep it lazy

            s = self.settings
            _patch_onnx_fetch(Path(s.models_dir).expanduser())
            t0 = time.perf_counter()
            log.info("Loading VieNeu mode=%s device=%s precision=%s", s.vieneu_mode, s.vieneu_device, s.vieneu_precision)
            self._tts = Vieneu(
                mode=s.vieneu_mode,
                backend=s.vieneu_backend,
                device=s.vieneu_device,
                precision=s.vieneu_precision,
            )
            log.info("Model loaded in %.1fs", time.perf_counter() - t0)
        if self.settings.warmup:
            t0 = time.perf_counter()
            with self._lock:
                self._tts.infer("Xin chào.")
            log.info("Warmup done in %.1fs", time.perf_counter() - t0)

    def voices(self) -> list[Voice]:
        if self._voices is None:
            tts = self._tts
            presets: dict = getattr(tts, "_preset_voices", None) or {}
            if presets:
                raw = [
                    {"id": name, "gender": v.get("gender") or None, "description": v.get("description") or None}
                    for name, v in presets.items()
                ]
            else:  # public API fallback: [(label, id)]
                raw = [{"id": vid} for _, vid in tts.list_preset_voices()]
            self._voices = build_voices(raw, getattr(tts, "_default_voice", None))
        return self._voices

    def resolve_voice(self, voice: str) -> str:
        resolver = getattr(self._tts, "resolve_voice_name", None)
        name = resolver(voice) if resolver else (voice if any(v.id == voice for v in self.voices()) else None)
        if name is None:
            raise UnknownVoiceError(f"unknown voice: {voice}")
        return name

    def synthesize(self, text: str, voice: str, speed: float, fmt: AudioFormat) -> EncodedAudio:
        name = self.resolve_voice(voice)
        t0 = time.perf_counter()
        with self._lock:
            wav = self._tts.infer(text, voice=name)
        samples = np.asarray(wav, dtype=np.float32)
        if samples.size == 0:
            raise ValueError("model produced no audio")
        sr = int(getattr(self._tts, "sample_rate", 48_000))
        infer_s = time.perf_counter() - t0
        out = apply_speed_and_encode(
            samples, sr, speed, fmt, ffmpeg_bin=self.settings.ffmpeg_bin, mp3_bitrate=self.settings.mp3_bitrate
        )
        log.info(
            "synth voice=%s chars=%d audio=%.2fs infer=%.2fs (RTF %.2f) speed=%.2f fmt=%s",
            name, len(text), out.duration, infer_s, infer_s / max(len(samples) / sr, 1e-6), speed, fmt,
        )
        return out
