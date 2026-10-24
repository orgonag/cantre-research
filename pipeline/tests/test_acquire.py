"""Tests for cantre_pipeline.acquire, provinces and the CLI stub, using a local HTTP server."""

import hashlib
import io
import json
import threading
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from functools import partial
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import pytest

from cantre_pipeline import cli
from cantre_pipeline.acquire import (
    SourceRecord,
    acquire,
    load_source,
    write_source,
)
from cantre_pipeline.errors import PipelineError
from cantre_pipeline.provinces import PROVINCES, TC_GCI, source_spec

PRJ = 'GEOGCS["GCS_North_American_1983_CSRS",DATUM["D_North_American_1983_CSRS"]]'
XML_NAME = "RFN_SK_2.0_20161006-135018.xml"
MEMBERS = {
    "NRWN_SK_2_0_TRACK.shp": b"shp-bytes",
    "NRWN_SK_2_0_TRACK.dbf": b"dbf-bytes",
    "NRWN_SK_2_0_TRACK.prj": PRJ.encode(),
    XML_NAME: b"<xml/>",
}
LAST_MODIFIED = "Thu, 25 Jul 2019 00:03:12 GMT"
CATALOGUE = "https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8"


def make_zip(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return buf.getvalue()


@dataclass
class Served:
    """A payload served on a local port, plus an opener that redirects any URL to it."""

    payload: bytes
    sha256: str
    members: dict[str, bytes]
    opener: Callable[..., Any]
    calls: list[str]

    def record_with(self, **changes: Any) -> SourceRecord:
        base = SourceRecord(
            sourceId="sk",
            kind="zip",
            url=PROVINCES["sk"],
            publisher="Natural Resources Canada",
            catalogueUrl=CATALOGUE,
            licenceName="Open Government Licence - Canada",
            licenceUrl="https://open.canada.ca/en/open-government-licence-canada",
            httpLastModified=LAST_MODIFIED,
            contentLength=len(self.payload),
            sha256=self.sha256,
            retrievedUtc="2026-10-24T00:00:00Z",
            packageVersion="2.0",
            crsWkt=PRJ,
            metadataMember=XML_NAME,
            members=(),
        )
        return replace(base, **changes)


def serve(payload: bytes, members: dict[str, bytes]) -> Iterator[Served]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Last-Modified", LAST_MODIFIED)
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: Any) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    calls: list[str] = []
    local = f"http://127.0.0.1:{server.server_address[1]}/x"

    def opener(request: Any, timeout: float | None = None) -> Any:
        calls.append(getattr(request, "full_url", str(request)))
        return urlopen(local, timeout=timeout)

    try:
        yield Served(payload, hashlib.sha256(payload).hexdigest(), members, opener, calls)
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def served_zip() -> Iterator[Served]:
    yield from serve(make_zip(MEMBERS), MEMBERS)


@pytest.fixture
def served_csv() -> Iterator[Served]:
    yield from serve("\ufeffTC Number,Mile\n1,2.5\n".encode(), {})


def canonical(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def test_record_mode_writes_canonical_source_file(tmp_path: Path, served_zip: Served) -> None:
    rec, extracted = acquire(
        "sk",
        cache_dir=tmp_path / "c",
        sources_dir=tmp_path / "s",
        record=True,
        opener=served_zip.opener,
    )
    text = (tmp_path / "s" / "sk.json").read_text(encoding="utf-8")
    data = json.loads(text)
    assert data["sha256"] == served_zip.sha256 and text.endswith("\n")
    assert [m["name"] for m in data["members"]] == sorted(served_zip.members)
    first = data["members"][0]
    assert first["sha256"] == hashlib.sha256(MEMBERS[first["name"]]).hexdigest()
    assert first["size"] == len(MEMBERS[first["name"]])
    assert data["packageVersion"] == "2.0" and data["crsWkt"] == PRJ
    assert data["metadataMember"] == XML_NAME
    assert data["httpLastModified"] == LAST_MODIFIED
    assert data["contentLength"] == len(served_zip.payload)
    assert data["retrievedUtc"].endswith("Z") and rec.sha256 == served_zip.sha256
    assert text == canonical(data)
    assert (extracted / "NRWN_SK_2_0_TRACK.prj").exists()
    assert extracted == tmp_path / "c" / served_zip.sha256
    assert load_source(tmp_path / "s", "sk") == rec


def test_verify_mode_accepts_matching_bytes_and_keeps_recorded_time(
    tmp_path: Path, served_zip: Served
) -> None:
    write_source(tmp_path / "s", served_zip.record_with())
    rec, extracted = acquire(
        "sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=served_zip.opener
    )
    assert rec.retrievedUtc == "2026-10-24T00:00:00Z"
    assert (extracted / "NRWN_SK_2_0_TRACK.shp").read_bytes() == b"shp-bytes"


def test_verify_mode_rejects_changed_bytes(tmp_path: Path, served_zip: Served) -> None:
    write_source(tmp_path / "s", served_zip.record_with(sha256="0" * 64))
    with pytest.raises(PipelineError) as e:
        acquire(
            "sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=served_zip.opener
        )
    assert e.value.code == "HASH_MISMATCH"
    assert not list((tmp_path / "c").glob("*.zip"))  # nothing unverified is kept


def test_cached_bytes_are_reverified_without_network(tmp_path: Path, served_zip: Served) -> None:
    write_source(tmp_path / "s", served_zip.record_with())
    acquire("sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=served_zip.opener)
    assert len(served_zip.calls) == 1

    def no_network(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("network used")

    _, extracted = acquire(
        "sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=no_network
    )
    assert (extracted / "NRWN_SK_2_0_TRACK.prj").exists()
    cached = tmp_path / "c" / f"{served_zip.sha256}.zip"
    cached.write_bytes(b"tampered")
    with pytest.raises(PipelineError) as e:
        acquire("sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=no_network)
    assert e.value.code == "HASH_MISMATCH"


def test_unknown_province_raises() -> None:
    with pytest.raises(PipelineError) as e:
        source_spec("zz")
    assert e.value.code == "UNKNOWN_PROVINCE"


def test_registry_values() -> None:
    assert PROVINCES["sk"].endswith("/sk/nrwn_rfn_sk_shp_en.zip")
    assert TC_GCI.sourceId == "tc-gci" and TC_GCI.kind == "file"
    assert source_spec("sk").kind == "zip" and source_spec("tc-gci") is TC_GCI


def test_file_source_is_hashed_and_copied_without_extraction(
    tmp_path: Path, served_csv: Served
) -> None:
    rec, extracted = acquire(
        "tc-gci",
        cache_dir=tmp_path / "c",
        sources_dir=tmp_path / "s",
        record=True,
        opener=served_csv.opener,
    )
    assert rec.kind == "file" and rec.members == () and rec.crsWkt is None
    assert rec.metadataMember is None and rec.packageVersion == "2023 update"
    assert rec.sha256 == served_csv.sha256
    copied = extracted / "en-grade-crossing-inventory-2023-update.csv"
    assert copied.read_bytes() == served_csv.payload
    assert [p.name for p in extracted.iterdir()] == [copied.name]
    # verify mode: from the cache, then with changed bytes.
    again, _ = acquire(
        "tc-gci", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=served_csv.opener
    )
    assert again == rec
    write_source(tmp_path / "s", replace(rec, sha256="1" * 64))
    with pytest.raises(PipelineError) as e:
        acquire(
            "tc-gci",
            cache_dir=tmp_path / "c2",
            sources_dir=tmp_path / "s",
            opener=served_csv.opener,
        )
    assert e.value.code == "HASH_MISMATCH"


@pytest.mark.parametrize("bad", ["../x", "/abs/x", "a/../../x", "C:/x", "..\\x"])
def test_zip_member_path_traversal_is_rejected(tmp_path: Path, bad: str) -> None:
    members = {**MEMBERS, bad: b"evil"}
    for served in serve(make_zip(members), members):
        with pytest.raises(PipelineError) as e:
            acquire(
                "sk",
                cache_dir=tmp_path / "c",
                sources_dir=tmp_path / "s",
                record=True,
                opener=served.opener,
            )
        assert e.value.code == "UNSAFE_ARCHIVE"
    assert not (tmp_path / "x").exists() and not (tmp_path.parent / "x").exists()


def test_zip_without_track_prj_or_metadata_is_schema_drift(tmp_path: Path) -> None:
    for drop in ("NRWN_SK_2_0_TRACK.prj", XML_NAME):
        members = {k: v for k, v in MEMBERS.items() if k != drop}
        for served in serve(make_zip(members), members):
            with pytest.raises(PipelineError) as e:
                acquire(
                    "sk",
                    cache_dir=tmp_path / "c",
                    sources_dir=tmp_path / "s",
                    record=True,
                    opener=served.opener,
                )
            assert e.value.code == "SCHEMA_DRIFT"


def test_unversioned_members_are_schema_drift(tmp_path: Path) -> None:
    members = {"TRACK.prj": b"x", "RFN.xml": b"<x/>"}
    for served in serve(make_zip(members), members):
        with pytest.raises(PipelineError) as e:
            acquire(
                "sk",
                cache_dir=tmp_path / "c",
                sources_dir=tmp_path / "s",
                record=True,
                opener=served.opener,
            )
        assert e.value.code == "SCHEMA_DRIFT"


def test_file_without_update_year_is_schema_drift(
    tmp_path: Path, served_csv: Served, monkeypatch: pytest.MonkeyPatch
) -> None:
    import cantre_pipeline.acquire as mod

    spec = replace(TC_GCI, url="https://example.invalid/inventory.csv")
    monkeypatch.setattr(mod, "source_spec", lambda _id: spec)
    with pytest.raises(PipelineError) as e:
        acquire(
            "tc-gci",
            cache_dir=tmp_path / "c",
            sources_dir=tmp_path / "s",
            record=True,
            opener=served_csv.opener,
        )
    assert e.value.code == "SCHEMA_DRIFT"


def test_download_failure_is_reported(tmp_path: Path) -> None:
    def broken(*_a: Any, **_k: Any) -> Any:
        raise OSError("no route")

    with pytest.raises(PipelineError) as e:
        acquire(
            "sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", record=True, opener=broken
        )
    assert e.value.code == "DOWNLOAD_FAILED"


def test_load_source_missing_or_malformed(tmp_path: Path) -> None:
    with pytest.raises(PipelineError) as e:
        load_source(tmp_path, "sk")
    assert e.value.code == "SCHEMA_DRIFT"
    (tmp_path / "sk.json").write_text('{"sourceId":"sk"}\n', encoding="utf-8")
    with pytest.raises(PipelineError) as e2:
        load_source(tmp_path, "sk")
    assert e2.value.code == "SCHEMA_DRIFT"


def test_committed_source_files_are_well_formed() -> None:
    sources = Path(__file__).resolve().parents[1] / "sources"
    for sid in ("sk", "tc-gci"):
        rec = load_source(sources, sid)
        assert len(rec.sha256) == 64 and rec.retrievedUtc.endswith("Z")
        assert rec.licenceName == "Open Government Licence - Canada"
        text = (sources / f"{sid}.json").read_text(encoding="utf-8")
        assert text.endswith("\n") and "\r" not in text


def test_cli_acquire(
    tmp_path: Path,
    served_zip: Served,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("CANTRE_RAW_DIR", str(tmp_path / "raw"))
    monkeypatch.setattr(cli, "SOURCES_DIR", tmp_path / "s")
    monkeypatch.setattr(cli, "acquire", partial(acquire, opener=served_zip.opener))
    assert cli.main(["acquire", "--province", "sk", "--record"]) == 0
    assert served_zip.sha256 in capsys.readouterr().out
    assert (tmp_path / "raw" / served_zip.sha256).is_dir()
    assert cli.main(["acquire", "--source", "sk"]) == 0
    assert cli.main(["acquire", "--source", "zz"]) == 2
    assert "UNKNOWN_PROVINCE" in capsys.readouterr().err


def test_cli_default_cache_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CANTRE_RAW_DIR", raising=False)
    assert cli.raw_dir().parts[-2:] == (".cache", "raw")


def test_module_entry_point_exits_with_cli_status(monkeypatch: pytest.MonkeyPatch) -> None:
    import runpy

    monkeypatch.setattr("sys.argv", ["cantre_pipeline", "acquire", "--source", "zz"])
    with pytest.raises(SystemExit) as e:
        runpy.run_module("cantre_pipeline", run_name="__main__")
    assert e.value.code == 2
