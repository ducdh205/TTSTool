import shutil

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings, get_settings
from app.engine import TtsEngine

KEY = "test-key"


class FakeVieneu:
    sample_rate = 24_000
    backend = "fake"
    _default_voice = "Hải Đăng"
    _preset_voices = {
        "Hải Đăng": {"gender": "male", "description": "Nam · Bắc · Phong cách tự nhiên"},
        "Thùy Dung": {"gender": "female", "description": "Nữ · Nam · Phong cách tin tức"},
    }
    _aliases = {"Minh Quân": "Hải Đăng"}

    def __init__(self):
        self.calls: list[tuple[str, str]] = []

    def resolve_voice_name(self, name):
        if name in self._preset_voices:
            return name
        return self._aliases.get(name)

    def infer(self, text, voice=None, **_):
        self.calls.append((text, voice))
        if text == "...":
            return np.array([], dtype=np.float32)
        return (0.2 * np.sin(np.arange(self.sample_rate) / 10)).astype(np.float32)


@pytest.fixture
def client(monkeypatch):
    settings = Settings(internal_api_key=KEY, warmup=False)
    fake = FakeVieneu()
    monkeypatch.setattr(main, "TtsEngine", lambda s: TtsEngine(s, tts=fake))
    main.app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    with TestClient(main.app) as c:
        c.fake = fake
        yield c
    main.app.dependency_overrides.clear()


def auth(**h):
    return {"x-internal-key": KEY, **h}


def test_health_is_public(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_requires_internal_key(client):
    assert client.get("/voices").status_code == 401
    assert client.get("/voices", headers={"x-internal-key": "nope"}).status_code == 401


def test_voices(client):
    r = client.get("/voices", headers=auth())
    assert r.status_code == 200
    by_id = {v["id"]: v for v in r.json()}
    assert by_id["Hải Đăng"]["region"] == "bac"
    assert by_id["Hải Đăng"]["isDefault"] is True
    assert by_id["Thùy Dung"]["region"] == "nam"


def test_unknown_voice_is_400(client):
    r = client.post("/synthesize", headers=auth(), json={"text": "xin chào", "voice": "Không có"})
    assert r.status_code == 400


def test_empty_model_output_is_422_not_500(client):
    r = client.post("/synthesize", headers=auth(), json={"text": "...", "voice": "Hải Đăng"})
    assert r.status_code == 422


@pytest.mark.parametrize("payload", [{"text": "", "voice": "Hải Đăng"}, {"text": "a", "voice": "Hải Đăng", "speed": 3}])
def test_validation(client, payload):
    assert client.post("/synthesize", headers=auth(), json=payload).status_code == 422


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_synthesize_wav_with_speed_and_alias(client):
    r = client.post(
        "/synthesize", headers=auth(), json={"text": " xin chào ", "voice": "Minh Quân", "speed": 2.0, "format": "wav"}
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert float(r.headers["x-audio-duration"]) == pytest.approx(0.5, rel=0.05)
    assert client.fake.calls[-1] == ("xin chào", "Hải Đăng")
