from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8001
    internal_api_key: str = "change-me"

    vieneu_mode: str = "v3turbo"
    vieneu_backend: str = "auto"
    vieneu_device: str = "cpu"
    vieneu_precision: str = "int8"
    warmup: bool = True

    max_chars: int = 3000
    ffmpeg_bin: str = "ffmpeg"
    mp3_bitrate: str = "128k"


@lru_cache
def get_settings() -> Settings:
    return Settings()
