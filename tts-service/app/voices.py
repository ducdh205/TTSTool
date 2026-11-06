"""Merge VieNeu preset voices with our region mapping (Bắc / Trung / Nam / Khác)."""

import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

Region = Literal["bac", "trung", "nam", "khac"]
REGIONS: tuple[Region, ...] = ("bac", "trung", "nam", "khac")

_REGIONS_FILE = Path(__file__).parent / "data" / "voice_regions.json"


class Voice(BaseModel):
    id: str
    name: str
    region: Region
    gender: str | None = None
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


def build_voices(raw_voices: list[dict], default_voice: str | None) -> list[Voice]:
    """raw_voices: dicts with at least `id` (or `name`); optional gender/description."""
    region_map = load_region_map()
    default_key = norm(default_voice) if default_voice else None
    out: list[Voice] = []
    for rv in raw_voices:
        vid = str(rv.get("id") or rv.get("name"))
        name = str(rv.get("name") or vid)
        out.append(
            Voice(
                id=vid,
                name=name,
                region=region_map.get(norm(vid)) or region_map.get(norm(name)) or "khac",
                gender=rv.get("gender"),
                description=rv.get("description"),
                isDefault=default_key is not None and norm(vid) == default_key,
            )
        )
    order = {r: i for i, r in enumerate(REGIONS)}
    out.sort(key=lambda v: (order[v.region], v.name))
    return out
