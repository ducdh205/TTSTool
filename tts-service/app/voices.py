"""Merge VieNeu preset voices with region info (Bắc / Trung / Nam / Khác).

VieNeu descriptions look like "Nữ · Bắc · Phong cách tin tức" (gender · region · style),
so the region is read from there first; data/voice_regions.json is a fallback for
voices whose description does not carry it (e.g. custom/fine-tuned voices).
"""

import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

Region = Literal["bac", "trung", "nam", "khac"]
REGIONS: tuple[Region, ...] = ("bac", "trung", "nam", "khac")

_REGIONS_FILE = Path(__file__).parent / "data" / "voice_regions.json"
_REGION_WORDS: dict[str, Region] = {"bắc": "bac", "trung": "trung", "nam": "nam"}
_GENDER_WORDS = {"nam": "male", "nữ": "female"}


class Voice(BaseModel):
    id: str
    name: str
    region: Region
    gender: str | None = None
    style: str | None = None
    description: str | None = None
    isDefault: bool = False


def norm(name: str) -> str:
    return unicodedata.normalize("NFC", name).strip().casefold()


@lru_cache
def load_region_map(path: Path = _REGIONS_FILE) -> dict[str, Region]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    mapping: dict[str, Region] = {}
    for region in ("bac", "trung", "nam"):
        for name in raw.get(region, []):
            mapping[norm(name)] = region
    return mapping


def parse_description(desc: str | None) -> tuple[str | None, Region | None, str | None]:
    """'Nữ · Bắc · Phong cách tin tức' -> ('female', 'bac', 'Phong cách tin tức')."""
    if not desc:
        return None, None, None
    parts = [p.strip() for p in unicodedata.normalize("NFC", desc).split("·")]
    if len(parts) < 2:
        return None, None, None
    gender = _GENDER_WORDS.get(parts[0].casefold())
    region = _REGION_WORDS.get(parts[1].casefold())
    style = parts[2] if len(parts) > 2 and parts[2] else None
    return gender, region, style


def build_voices(raw_voices: list[dict], default_voice: str | None) -> list[Voice]:
    """raw_voices: dicts with `id` (or `name`), optional `gender` / `description`."""
    region_map = load_region_map()
    default_key = norm(default_voice) if default_voice else None
    out: list[Voice] = []
    for rv in raw_voices:
        vid = str(rv.get("id") or rv.get("name"))
        name = str(rv.get("name") or vid)
        desc = rv.get("description") or None
        d_gender, d_region, d_style = parse_description(desc)
        region = d_region or region_map.get(norm(vid)) or region_map.get(norm(name)) or "khac"
        out.append(
            Voice(
                id=vid,
                name=name,
                region=region,
                gender=rv.get("gender") or d_gender,
                style=d_style,
                description=desc,
                isDefault=default_key is not None and norm(vid) == default_key,
            )
        )
    order = {r: i for i, r in enumerate(REGIONS)}
    out.sort(key=lambda v: (order[v.region], not v.isDefault, v.name))
    return out
