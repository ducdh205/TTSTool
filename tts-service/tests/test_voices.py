import unicodedata

from app.voices import build_voices


def test_regions_and_default():
    raw = [
        {"id": "Phạm Tuyên", "gender": "male"},
        {"id": "Quang Sơn"},
        {"id": "Thái Sơn"},
        {"id": "Hải Đăng"},
    ]
    voices = {v.id: v for v in build_voices(raw, default_voice="Hải Đăng")}
    assert voices["Phạm Tuyên"].region == "bac"
    assert voices["Phạm Tuyên"].gender == "male"
    assert voices["Quang Sơn"].region == "trung"
    assert voices["Thái Sơn"].region == "nam"
    assert voices["Hải Đăng"].region == "khac"
    assert voices["Hải Đăng"].isDefault
    assert not voices["Thái Sơn"].isDefault


def test_unicode_normalization_matches_nfd_names():
    nfd = unicodedata.normalize("NFD", "Ngọc Trân")
    [v] = build_voices([{"id": nfd}], default_voice=None)
    assert v.region == "trung"


def test_sorted_by_region():
    raw = [{"id": "Adam"}, {"id": "Mai Anh"}, {"id": "Minh Đức"}, {"id": "Quang Sơn"}]
    assert [v.region for v in build_voices(raw, None)] == ["bac", "trung", "nam", "khac"]
