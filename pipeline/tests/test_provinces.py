"""Tests for the province registry: every code is registered or explained (M4 Task 1)."""

from cantre_pipeline.provinces import NO_PACKAGE, NRWN_BASE, PROVINCES, source_spec

ALL_CODES = {"ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt"}


def test_every_code_registered_or_explained() -> None:
    assert set(PROVINCES) | NO_PACKAGE == ALL_CODES
    assert not set(PROVINCES) & NO_PACKAGE


def test_registered_urls_follow_the_nrwn_layout() -> None:
    for pr, url in PROVINCES.items():
        assert url == f"{NRWN_BASE}/{pr}/nrwn_rfn_{pr}_shp_en.zip"
        assert source_spec(pr).kind == "zip"
