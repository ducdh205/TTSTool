import unicodedata

from app.voices import build_voices, parse_description


def test_parse_description():
    assert parse_description("Nữ · Bắc · Phong cách tin tức") == ("female", "bac", "Phong cách tin tức")
    assert parse_description("Nam · Nam · Phong cách kể chuyện") == ("male", "nam", "Phong cách kể chuyện")
    assert parse_description("Nam · Trung") == ("male", "trung", None)
    assert parse_description("whatever") == (None, None, None)
    assert parse_description(None) == (None, None, None)


def test_region_from_description_wins_and_default():
    raw = [
        {"id": "Hải Đăng", "gender": "male", "description": "Nam · Bắc · Phong cách tự nhiên"},
        {"id": "Thùy Dung", "description": "Nữ · Nam · Phong cách tin tức"},
        {"id": "Quang Sơn", "description": "Nam · Trung · Phong cách tự nhiên"},
    ]
    voices = {v.id: v for v in build_voices(raw, default_voice="Hải Đăng")}
    assert voices["Hải Đăng"].region == "bac"
    assert voices["Hải Đăng"].isDefault
    assert voices["Thùy Dung"].region == "nam"
    assert voices["Thùy Dung"].gender == "female"
    assert voices["Quang Sơn"].region == "trung"
    assert voices["Quang Sơn"].style == "Phong cách tự nhiên"


def test_fallback_to_region_file_then_khac():
    raw = [{"id": "Phạm Tuyên"}, {"id": "Giọng lạ"}]
    voices = {v.id: v for v in build_voices(raw, None)}
    assert voices["Phạm Tuyên"].region == "bac"
    assert voices["Giọng lạ"].region == "khac"


def test_unicode_normalization_matches_nfd_names():
    nfd = unicodedata.normalize("NFD", "Ngọc Trân")
    [v] = build_voices([{"id": nfd}], default_voice=None)
    assert v.region == "trung"


def test_sorted_by_region_default_first():
    raw = [
        {"id": "Adam"},
        {"id": "Zeta", "description": "Nam · Bắc"},
        {"id": "Minh Đức"},
        {"id": "Quang Sơn"},
        {"id": "Hải Đăng", "description": "Nam · Bắc"},
    ]
    ids = [v.id for v in build_voices(raw, "Hải Đăng")]
    assert ids == ["Hải Đăng", "Minh Đức", "Zeta", "Quang Sơn", "Adam"]
