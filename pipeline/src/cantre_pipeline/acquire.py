"""Acquire a source, verify its bytes against a committed hash, and record provenance.

Two modes (spec section 5):

* verify (default): the SHA-256 in ``sources/<id>.json`` is authoritative. Cached bytes are
  re-hashed before use; a download that does not match is discarded and raises ``HASH_MISMATCH``.
* record (``record=True``): the source is downloaded, its provenance is measured and
  ``sources/<id>.json`` is rewritten. ``retrievedUtc`` is the real retrieval time and is written
  only in this mode, never invented.

Raw bytes live in the cache directory (git-ignored), never in the repository.
"""

import hashlib
import http.client
import json
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Literal
from urllib.parse import unquote, urlparse

from cantre_pipeline.errors import PipelineError
from cantre_pipeline.provinces import OGL_NAME, OGL_URL, SourceSpec, source_spec

Opener = Callable[..., Any]
"""``urllib.request.urlopen``-compatible callable; tests inject a local-server opener."""

_CHUNK = 1 << 20
_USER_AGENT = "cantre-pipeline/0.1 (research; +https://github.com/orgonag/cantre-research)"


@dataclass(frozen=True)
class Member:
    """One archive member: its name, uncompressed size in bytes and SHA-256."""

    name: str
    size: int
    sha256: str


@dataclass(frozen=True)
class SourceRecord:
    """Provenance of one acquired source (the content of ``sources/<id>.json``).

    ``members`` is sorted by name and empty for a ``"file"`` source. ``crsWkt`` is the TRACK
    ``.prj`` text verbatim (``None`` for a file). ``retrievedUtc`` is ISO 8601 with ``Z``.
    """

    sourceId: str  # noqa: N815 - field names are the committed JSON keys
    kind: Literal["zip", "file"]
    url: str
    publisher: str
    catalogueUrl: str  # noqa: N815
    licenceName: str  # noqa: N815
    licenceUrl: str  # noqa: N815
    httpLastModified: str | None  # noqa: N815
    contentLength: int  # noqa: N815
    sha256: str
    retrievedUtc: str  # noqa: N815
    packageVersion: str  # noqa: N815
    crsWkt: str | None  # noqa: N815
    metadataMember: str | None  # noqa: N815
    members: tuple[Member, ...]


def canonical_json(data: object) -> str:
    """Return canonical JSON: sorted keys, compact separators, UTF-8 text, one trailing newline."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def write_source(sources_dir: Path, record: SourceRecord) -> Path:
    """Write ``record`` as canonical JSON to ``sources_dir/<sourceId>.json`` (LF endings)."""
    sources_dir.mkdir(parents=True, exist_ok=True)
    path = sources_dir / f"{record.sourceId}.json"
    path.write_bytes(canonical_json(asdict(record)).encode("utf-8"))
    return path


def load_source(sources_dir: Path, source_id: str) -> SourceRecord:
    """Load ``sources_dir/<source_id>.json``.

    Raises:
        PipelineError: ``SCHEMA_DRIFT`` when the file is missing or does not have the fields of
            :class:`SourceRecord`.
    """
    path = sources_dir / f"{source_id}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["members"] = tuple(Member(**m) for m in data["members"])
        return SourceRecord(**data)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise PipelineError(
            "SCHEMA_DRIFT", f"cannot load source record {path.name}: {exc}"
        ) from exc


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _download(
    spec: SourceSpec, cache_dir: Path, opener: Opener
) -> tuple[Path, str, int, str | None]:
    """Stream ``spec.url`` into a temporary file; return (temp path, sha256, size, Last-Modified).

    The caller renames the file into place once the hash is accepted.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(spec.url, headers={"User-Agent": _USER_AGENT})  # noqa: S310
    digest = hashlib.sha256()
    size = 0
    fd, name = tempfile.mkstemp(dir=cache_dir, suffix=".part")
    part = Path(name)
    try:
        with os.fdopen(fd, "wb") as tmp, opener(request, timeout=120) as response:
            last_modified = response.headers.get("Last-Modified")
            declared = response.headers.get("Content-Length")
            while chunk := response.read(_CHUNK):
                tmp.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if declared is not None and int(declared) != size:
            raise PipelineError(
                "TRUNCATED_DOWNLOAD",
                f"{spec.url}: received {size} bytes, Content-Length {declared}",
            )
    except http.client.HTTPException as exc:  # includes IncompleteRead
        part.unlink(missing_ok=True)
        raise PipelineError("TRUNCATED_DOWNLOAD", f"{spec.url}: {exc!r}") from exc
    except OSError as exc:  # URLError and HTTPError are OSError subclasses
        part.unlink(missing_ok=True)
        raise PipelineError("DOWNLOAD_FAILED", f"cannot download {spec.url}: {exc}") from exc
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return part, digest.hexdigest(), size, last_modified


def _check_member_name(name: str) -> str:
    """Reject absolute paths, drive letters and ``..`` in an archive member name (zip-slip)."""
    posix = name.replace("\\", "/")
    parts = PurePosixPath(posix).parts
    if posix.startswith("/") or ".." in parts or (parts and ":" in parts[0]):
        raise PipelineError("UNSAFE_ARCHIVE", f"unsafe archive member name {name!r}")
    return posix


def _write_member(target: Path, data: bytes) -> None:
    """Write one extracted member (a seam so tests can simulate a short extraction)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def _extract(zip_path: Path, dest: Path) -> tuple[Member, ...]:
    """Extract ``zip_path`` into ``dest``; return the archive's file list from the zip stream.

    All member names are validated before anything is written (zip-slip guard). The returned
    members (name, uncompressed size, SHA-256 of the bytes read from the zip, sorted by name) come
    from the archive, not from the disk, so a short extraction cannot hide in them.

    Raises:
        PipelineError: ``UNSAFE_ARCHIVE``; ``TRUNCATED_DOWNLOAD`` for an unreadable zip;
            ``INCOMPLETE_EXTRACTION`` when a file cannot be written (the message names
            ``CANTRE_RAW_DIR`` and the path length, the usual Windows cause).
    """
    members: list[Member] = []
    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = [i for i in zf.infolist() if not i.is_dir()]
            names = {i.filename: _check_member_name(i.filename) for i in infos}
            for info in infos:
                data = zf.read(info)
                target = dest / names[info.filename]
                try:
                    _write_member(target, data)
                except OSError as exc:
                    raise PipelineError(
                        "INCOMPLETE_EXTRACTION",
                        f"cannot write {names[info.filename]} ({len(str(target))}-character path): "
                        f"{exc}. Set CANTRE_RAW_DIR to a shorter directory.",
                    ) from exc
                members.append(
                    Member(names[info.filename], len(data), hashlib.sha256(data).hexdigest())
                )
    except (zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise PipelineError("TRUNCATED_DOWNLOAD", f"not a readable zip: {exc!r}") from exc
    return tuple(sorted(members, key=lambda m: m.name))


def _zip_metadata(members: tuple[Member, ...], root: Path) -> tuple[str, str, str]:
    """Return (packageVersion, crsWkt, metadataMember) read from the NRWN member names."""
    names = [m.name for m in members]
    version = next(
        (
            f"{m.group(1)}.{m.group(2)}"
            for n in names
            if (m := re.match(r"NRWN_[A-Z]{2}_(\d+)_(\d+)_", n))
        ),
        None,
    )
    track_prj = next((n for n in names if n.upper().endswith("_TRACK.PRJ")), None)
    metadata = next((n for n in names if re.fullmatch(r"RFN_.*\.xml", n)), None)
    if version is None or track_prj is None or metadata is None:
        raise PipelineError(
            "SCHEMA_DRIFT",
            "NRWN package needs NRWN_<pr>_<maj>_<min>_* members, a TRACK .prj and an RFN_*.xml",
        )
    try:
        crs = (root / track_prj).read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise PipelineError("SCHEMA_DRIFT", f"{track_prj} is not UTF-8 text: {exc}") from exc
    return version, crs, metadata


def _file_version(spec: SourceSpec) -> str:
    """Return e.g. ``"2023 update"`` from a file name containing ``<year>-update``."""
    match = re.search(r"(\d{4})-update", urlparse(spec.url).path)
    if match is None:
        raise PipelineError("SCHEMA_DRIFT", f"no '<year>-update' in the file name of {spec.url}")
    return f"{match.group(1)} update"


def _materialise(
    spec: SourceSpec, raw: Path, sha256: str, cache_dir: Path, expected: tuple[Member, ...] | None
) -> tuple[Path, tuple[Member, ...]]:
    """Extract (zip) or copy (file) ``raw`` into ``cache_dir/<sha256>/``, replacing any old copy.

    Returns the directory and the archive's file list. Before the directory is put in place, the
    files on disk (names, sizes, SHA-256) must equal that list and, when ``expected`` is given,
    the recorded ``members``; a file source's copy must hash to ``sha256``.

    Raises:
        PipelineError: ``INCOMPLETE_EXTRACTION`` on any difference.
    """
    final = cache_dir / sha256
    staging = Path(tempfile.mkdtemp(dir=cache_dir, prefix=".stage-"))
    try:
        if spec.kind == "zip":
            listed = _extract(raw, staging)
            on_disk = _members_of(staging)
            if on_disk != listed or (expected is not None and on_disk != expected):
                recorded = f", {len(expected)} recorded" if expected is not None else ""
                raise PipelineError(
                    "INCOMPLETE_EXTRACTION",
                    f"extracted files differ from the archive list ({len(on_disk)} on disk, "
                    f"{len(listed)} in the zip{recorded}). "
                    "Set CANTRE_RAW_DIR to a shorter directory if paths are long.",
                )
        else:
            listed = ()
            copy = staging / Path(unquote(urlparse(spec.url).path)).name
            shutil.copyfile(raw, copy)
            if _sha256_file(copy) != sha256:
                raise PipelineError("INCOMPLETE_EXTRACTION", f"copy of {copy.name} is corrupt")
        if final.exists():
            shutil.rmtree(final)
        staging.rename(final)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return final, listed


def acquire(
    source_id: str,
    *,
    cache_dir: Path,
    sources_dir: Path,
    record: bool = False,
    opener: Opener = urllib.request.urlopen,
) -> tuple[SourceRecord, Path]:
    """Fetch ``source_id``, verify or record its provenance, and return (record, directory).

    Rule: verify mode trusts only ``sources/<id>.json``; the cached copy
    ``cache_dir/<sha256>.zip|.bin`` is re-hashed before every use and the network is touched only
    when it is absent. Record mode always downloads and rewrites the source file. The directory
    returned is ``cache_dir/<sha256>/``: the extracted package, or the single copied file.

    Args:
        source_id: A province code (``"sk"``) or ``"tc-gci"``.
        cache_dir: Raw-byte cache (git-ignored).
        sources_dir: Directory of committed ``<id>.json`` provenance files.
        record: Measure and write provenance instead of verifying it.
        opener: ``urlopen``-compatible callable (injected in tests).

    Raises:
        PipelineError: ``UNKNOWN_PROVINCE``, ``DOWNLOAD_FAILED``, ``HASH_MISMATCH``,
            ``UNSAFE_ARCHIVE``, ``TRUNCATED_DOWNLOAD``, ``INCOMPLETE_EXTRACTION`` or
            ``SCHEMA_DRIFT``.
    """
    spec = source_spec(source_id)
    suffix = ".zip" if spec.kind == "zip" else ".bin"
    known = None if record else load_source(sources_dir, source_id)
    last_modified: str | None = None
    retrieved = ""
    if known is not None and (cached := cache_dir / f"{known.sha256}{suffix}").exists():
        if _sha256_file(cached) != known.sha256:
            raise PipelineError("HASH_MISMATCH", f"cached {cached.name} no longer matches its hash")
        raw, sha256, size = cached, known.sha256, cached.stat().st_size
    else:
        retrieved = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        part, sha256, size, last_modified = _download(spec, cache_dir, opener)
        if known is not None and sha256 != known.sha256:
            part.unlink()
            raise PipelineError(
                "HASH_MISMATCH", f"{source_id}: downloaded {sha256}, expected {known.sha256}"
            )
        raw = cache_dir / f"{sha256}{suffix}"
        part.replace(raw)
    extracted, members = _materialise(
        spec, raw, sha256, cache_dir, known.members if known is not None else None
    )
    if known is not None:
        return known, extracted
    if spec.kind == "zip":
        version, crs, metadata = _zip_metadata(members, extracted)
        crs_wkt: str | None = crs
        metadata_member: str | None = metadata
    else:
        version, crs_wkt, metadata_member = _file_version(spec), None, None
    rec = SourceRecord(
        sourceId=source_id,
        kind=spec.kind,
        url=spec.url,
        publisher=spec.publisher,
        catalogueUrl=spec.catalogueUrl,
        licenceName=OGL_NAME,
        licenceUrl=OGL_URL,
        httpLastModified=last_modified,
        contentLength=size,
        sha256=sha256,
        retrievedUtc=retrieved,
        packageVersion=version,
        crsWkt=crs_wkt,
        metadataMember=metadata_member,
        members=members,
    )
    write_source(sources_dir, rec)
    return rec, extracted


def _members_of(directory: Path) -> tuple[Member, ...]:
    """Hash the extracted files under ``directory``; members sorted by POSIX relative name."""
    found = [
        Member(
            p.relative_to(directory).as_posix(),
            p.stat().st_size,
            _sha256_file(p),
        )
        for p in directory.rglob("*")
        if p.is_file()
    ]
    return tuple(sorted(found, key=lambda m: m.name))
