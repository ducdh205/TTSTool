import io
import shutil
import wave

import numpy as np
import pytest

from app.audio import apply_speed_and_encode, to_mono_float32

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

SR = 24000


def _tone(seconds: float) -> np.ndarray:
    t = np.arange(int(SR * seconds)) / SR
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _wav_seconds(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as w:
        return w.getnframes() / w.getframerate()


@pytest.mark.parametrize("speed", [0.5, 1.0, 1.5, 2.0])
def test_speed_changes_duration(speed):
    out = apply_speed_and_encode(_tone(2.0), SR, speed, "wav")
    assert out.media_type == "audio/wav"
    assert _wav_seconds(out.data) == pytest.approx(2.0 / speed, rel=0.05)
    assert out.duration == pytest.approx(2.0 / speed, rel=0.01)


def test_mp3_encoding():
    out = apply_speed_and_encode(_tone(1.0), SR, 1.0, "mp3")
    assert out.media_type == "audio/mpeg"
    assert out.data[:3] == b"ID3" or out.data[0] == 0xFF


@pytest.mark.parametrize("speed", [0.4, 2.1])
def test_speed_out_of_range(speed):
    with pytest.raises(ValueError):
        apply_speed_and_encode(_tone(0.1), SR, speed, "wav")


def test_to_mono_handles_stereo():
    stereo = np.stack([_tone(0.1), _tone(0.1)])
    assert to_mono_float32(stereo).ndim == 1
