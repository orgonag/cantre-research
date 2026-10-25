"""Tests for download retries (M4 Task 1): timeouts retry with backoff, hash mismatches never."""

import hashlib
import io
from pathlib import Path
from typing import Any
from urllib.error import HTTPError

import pytest

from cantre_pipeline.acquire import MAX_ATTEMPTS, SourceRecord, acquire, write_source
from cantre_pipeline.errors import PipelineError
from test_acquire import MEMBERS, make_zip

PAYLOAD = make_zip(MEMBERS)
SHA = hashlib.sha256(PAYLOAD).hexdigest()


class FakeResponse:
    def __init__(self, data: bytes) -> None:
        self._buf = io.BytesIO(data)
        self.headers = {"Content-Length": str(len(data)), "Last-Modified": "x"}

    def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FlakyOpener:
    """Raises each of ``failures`` in turn, then serves ``data``."""

    def __init__(self, failures: list[BaseException], data: bytes = PAYLOAD) -> None:
        self.failures = list(failures)
        self.data = data
        self.calls = 0

    def __call__(self, request: Any, timeout: float = 0) -> FakeResponse:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return FakeResponse(self.data)


def _record(sources: Path, sha: str) -> None:
    base = SourceRecord(
        sourceId="sk",
        kind="zip",
        url="https://example.invalid/sk.zip",
        publisher="p",
        catalogueUrl="c",
        licenceName="l",
        licenceUrl="u",
        httpLastModified=None,
        contentLength=len(PAYLOAD),
        sha256=sha,
        retrievedUtc="2026-01-01T00:00:00Z",
        packageVersion="2.0",
        crsWkt="w",
        metadataMember="m",
        members=(),
    )
    write_source(sources, base)


def test_retry_then_verify(tmp_path: Path) -> None:
    sources, cache = tmp_path / "s", tmp_path / "c"
    opener = FlakyOpener([TimeoutError("t1"), TimeoutError("t2")])
    sleeps: list[float] = []
    rec, _ = acquire(
        "sk", cache_dir=cache, sources_dir=sources, record=True, opener=opener, sleep=sleeps.append
    )
    assert opener.calls == 3 and sleeps == [1, 2]
    assert rec.sha256 == SHA


def test_gives_up_after_max_attempts_with_backoff(tmp_path: Path) -> None:
    opener = FlakyOpener([TimeoutError("t")] * 10)
    sleeps: list[float] = []
    with pytest.raises(PipelineError) as err:
        acquire(
            "sk",
            cache_dir=tmp_path / "c",
            sources_dir=tmp_path / "s",
            record=True,
            opener=opener,
            sleep=sleeps.append,
        )
    assert err.value.code == "DOWNLOAD_FAILED"
    assert opener.calls == MAX_ATTEMPTS == 5 and sleeps == [1, 2, 4, 8]


def test_connection_error_retries(tmp_path: Path) -> None:
    opener = FlakyOpener([ConnectionResetError("reset")])
    sleeps: list[float] = []
    acquire(
        "sk",
        cache_dir=tmp_path / "c",
        sources_dir=tmp_path / "s",
        record=True,
        opener=opener,
        sleep=sleeps.append,
    )
    assert opener.calls == 2 and sleeps == [1]


def test_http_error_is_not_retried(tmp_path: Path) -> None:
    err = HTTPError("https://example.invalid/sk.zip", 404, "Not Found", {}, None)  # type: ignore[arg-type]
    opener = FlakyOpener([err])
    sleeps: list[float] = []
    with pytest.raises(PipelineError) as exc:
        acquire(
            "sk",
            cache_dir=tmp_path / "c",
            sources_dir=tmp_path / "s",
            record=True,
            opener=opener,
            sleep=sleeps.append,
        )
    assert exc.value.code == "DOWNLOAD_FAILED"
    assert opener.calls == 1 and sleeps == []


def test_hash_mismatch_is_never_retried(tmp_path: Path) -> None:
    sources, cache = tmp_path / "s", tmp_path / "c"
    _record(sources, "0" * 64)
    opener = FlakyOpener([])
    sleeps: list[float] = []
    with pytest.raises(PipelineError) as exc:
        acquire("sk", cache_dir=cache, sources_dir=sources, opener=opener, sleep=sleeps.append)
    assert exc.value.code == "HASH_MISMATCH"
    assert opener.calls == 1 and sleeps == []
