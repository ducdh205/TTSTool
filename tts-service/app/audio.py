"""Post-processing: tempo change (pitch-preserving) + encoding via ffmpeg."""

import subprocess
from dataclasses import dataclass
from typing import Literal

import numpy as np

AudioFormat = Literal["mp3", "wav"]

MIN_SPEED = 0.5
MAX_SPEED = 2.0


class AudioProcessingError(RuntimeError):
    pass


@dataclass(frozen=True)
class EncodedAudio:
    data: bytes
    duration: float
    sample_rate: int
    media_type: str


MEDIA_TYPES: dict[str, str] = {"mp3": "audio/mpeg", "wav": "audio/wav"}


def to_mono_float32(samples: np.ndarray) -> np.ndarray:
    arr = np.asarray(samples, dtype=np.float32)
    if arr.ndim == 2:
        # (channels, n) or (n, channels) -> mono
        arr = arr.mean(axis=0 if arr.shape[0] < arr.shape[1] else 1)
    elif arr.ndim > 2:
        arr = arr.reshape(-1)
    return np.clip(arr, -1.0, 1.0)


def apply_speed_and_encode(
    samples: np.ndarray,
    sample_rate: int,
    speed: float = 1.0,
    fmt: AudioFormat = "mp3",
    *,
    ffmpeg_bin: str = "ffmpeg",
    mp3_bitrate: str = "128k",
) -> EncodedAudio:
    """Time-stretch with ffmpeg `atempo` (keeps pitch) and encode to mp3/wav."""
    if not MIN_SPEED <= speed <= MAX_SPEED:
        raise ValueError(f"speed must be within [{MIN_SPEED}, {MAX_SPEED}]")
    if fmt not in MEDIA_TYPES:
        raise ValueError(f"unsupported format: {fmt}")

    mono = to_mono_float32(samples)
    cmd = [
        ffmpeg_bin, "-hide_banner", "-loglevel", "error",
        "-f", "f32le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
    ]
    if abs(speed - 1.0) > 1e-3:
        cmd += ["-filter:a", f"atempo={speed:.3f}"]
    if fmt == "mp3":
        cmd += ["-c:a", "libmp3lame", "-b:a", mp3_bitrate, "-f", "mp3", "pipe:1"]
    else:
        cmd += ["-c:a", "pcm_s16le", "-f", "wav", "pipe:1"]

    try:
        proc = subprocess.run(cmd, input=mono.tobytes(), capture_output=True, check=False)
    except FileNotFoundError as e:
        raise AudioProcessingError(f"ffmpeg not found ({ffmpeg_bin})") from e
    if proc.returncode != 0 or not proc.stdout:
        raise AudioProcessingError(proc.stderr.decode(errors="replace").strip() or "ffmpeg failed")

    duration = len(mono) / sample_rate / speed
    return EncodedAudio(proc.stdout, round(duration, 3), sample_rate, MEDIA_TYPES[fmt])
