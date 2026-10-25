"""The national snapshot (``snapshot.bin.gz``) and the asset-details file (M4 Task 2).

A snapshot is the whole network of one national build in one file, so the app downloads the same
bytes everywhere and the host never learns where anyone is (M4 decision D1). The byte layout is
the contract in ``pipeline/schema/snapshot.md``; read that first. This module holds:

* :class:`NetworkMerger`, which folds the tiles of each province into one network: chain pieces
  are merged into whole chains, tile overlaps are removed, and an id seen twice must be equal;
* :func:`encode_snapshot` and :func:`encode_asset_details`, the writers;
* :func:`read_snapshot`, a reader used only by tests (the app's decoder is TypeScript).

Units. Coordinates are integer microdegrees (``latE6``, ``lonE6``), along-chain distance ``s`` is
integer millimetres (``sMm``), mileposts are miles. Everything in the geometry stream is an
integer, so the full M2 precision is kept: nothing is rounded between the tiles and the snapshot.

Determinism. Records are written in a fixed order (see :func:`encode_snapshot`), JSON uses the
pipeline's canonical encoder and the gzip header carries no time or file name (:func:`gzip_bytes`),
so the same tiles give the same bytes.
"""

import gzip
import hashlib
import json
import struct
from array import array
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import accumulate
from typing import Any

from cantre_pipeline.encode import canonical_json, gzip_bytes, to_e6
from cantre_pipeline.errors import PipelineError

__all__ = [
    "FORMAT_VERSION",
    "MAGIC",
    "VARINT_MAX",
    "VARINT_MIN",
    "NetworkMerger",
    "ProvinceCounts",
    "Snapshot",
    "encode_asset_details",
    "encode_snapshot",
    "gzip_bytes",
    "read_snapshot",
    "read_varint",
    "write_varint",
]

MAGIC = b"CNTS"
"""First four bytes of the decompressed snapshot ("CANTRE snapshot")."""

FORMAT_VERSION = 1
"""The ``u8`` after the magic. A reader must refuse any other value."""

VARINT_MIN = -(1 << 52)
VARINT_MAX = (1 << 52) - 1
"""Range of a geometry value. The zigzag form of this range is below 2**53, so a JavaScript
``Number`` holds it exactly. Real values are far inside it: a delta of microdegrees is below
2**28 and a delta of millimetres along a chain is below 2**34 (chains are shorter than 10**7 m)."""

TileObj = dict[str, Any]

_U32 = struct.Struct("<I")
_MAX_VARINT_BYTES = 8
"""A zigzag value below 2**53 needs at most ceil(53 / 7) = 8 LEB128 bytes."""


# --- varints ----------------------------------------------------------------------------------


def write_varint(buf: bytearray, n: int) -> None:
    """Append ``n`` to ``buf`` as a zigzag LEB128 varint.

    Zigzag maps signed to unsigned so small magnitudes stay small: ``z = 2n`` for ``n >= 0`` and
    ``z = -2n - 1`` for ``n < 0`` (0, -1, 1, -2, 2 become 0, 1, 2, 3, 4). LEB128 then writes ``z``
    seven bits at a time, least significant group first, with bit 7 set on every byte but the
    last. Limit: ``VARINT_MIN <= n <= VARINT_MAX`` (about +-4.5e15), so the value is exact in a
    JavaScript ``Number``.

    Raises:
        ValueError: if ``n`` is outside that range.
    """
    if not VARINT_MIN <= n <= VARINT_MAX:
        raise ValueError(f"varint value {n} outside [{VARINT_MIN}, {VARINT_MAX}]")
    z = n << 1 if n >= 0 else ((-n) << 1) - 1
    while z >= 0x80:
        buf.append((z & 0x7F) | 0x80)
        z >>= 7
    buf.append(z)


def read_varint(data: bytes | memoryview, pos: int) -> tuple[int, int]:
    """Read one zigzag LEB128 varint at ``pos``; return ``(value, next position)``.

    Raises:
        ValueError: if the data ends inside the varint or it is longer than 8 bytes.
    """
    z = 0
    shift = 0
    for i in range(_MAX_VARINT_BYTES):
        if pos + i >= len(data):
            raise ValueError("snapshot geometry ends inside a varint")
        b = data[pos + i]
        z |= (b & 0x7F) << shift
        if b < 0x80:
            if b == 0 and i > 0:
                raise ValueError("varint is not in minimal form")
            if z >= 1 << 53:
                raise ValueError("varint value outside -2**52..2**52-1")
            return (z >> 1 if z % 2 == 0 else -((z + 1) >> 1)), pos + i + 1
        shift += 7
    raise ValueError("varint longer than 8 bytes")


# --- merging tiles into one network -----------------------------------------------------------


@dataclass(frozen=True)
class ProvinceCounts:
    """What one province contributed, counted over its own tiles with overlaps removed.

    A feature that two provinces share (same id and equal) counts in both, so the sums over
    provinces can exceed the national totals by the shared ones.

    Attributes:
        chains: Whole chains.
        vertices: Chain vertices (the geometry stream writes three integers for each).
        segments: Segments that belong to no chain.
        anchors: Anchors.
        intervals: Intervals.
        assets: Assets.
    """

    chains: int
    vertices: int
    segments: int
    anchors: int
    intervals: int
    assets: int


@dataclass
class _Chain:
    """A whole chain: absolute integer vertices (microdegrees, millimetres)."""

    id: str
    sub_nid: str
    sub_name: str
    operators: list[str]
    cycle: bool
    lat: array[int]
    lon: array[int]
    s: array[int]
    classes: set[str] = field(default_factory=set)


@dataclass
class _Segment:
    """An unchained segment: absolute integer vertices in the tile's canonical direction."""

    key: str
    track_class: str
    status: str
    sub_nid: str
    sub_name: str
    operator: str
    geo_accuracy_m: int | None
    lat: array[int]
    lon: array[int]


@dataclass
class _Piece:
    """One tile's piece of a chain, decoded to absolute integers."""

    tile: str
    chain: TileObj
    start: int
    lat: array[int]
    lon: array[int]
    s: array[int]


def _absolute(deltas: Sequence[int]) -> array[int]:
    """Undo first-absolute-then-differences encoding: a running sum, as a 64-bit array."""
    return array("q", accumulate(deltas))


def _digest(obj: object) -> bytes:
    """SHA-256 of the canonical JSON of ``obj``: equal digests mean byte-equal objects."""
    return hashlib.sha256(canonical_json(obj)).digest()


def _conflict(message: str) -> PipelineError:
    return PipelineError("MERGE_CONFLICT", message)


class NetworkMerger:
    """Folds the tiles of one or more provinces into one network (ruling P12).

    Rules:

    * chain pieces with one id are merged by ``vertexStart``. Overlapping vertices must agree
      exactly in ``latE6``, ``lonE6`` and ``sMm`` and are kept once. A gap in the vertex indices
      is an error, because a province's tiles are all present: the merger never bridges a gap;
    * a chain's id is a hash of its segments, so two provinces never share one in practice. If
      they did, the two chains must be equal;
    * segments, anchors (by chain id and anchor id), intervals and assets are keyed by id. An id
      seen again, in another tile or another province, must be byte-equal (canonical JSON) and is
      then kept once; otherwise the build stops with ``MERGE_CONFLICT`` naming the id. Nothing is
      overwritten;
    * every tile of every province must carry one ``datasetVersion``;
    * the coverage is the set of tile cells (unbuffered bounds), de-duplicated.

    Nothing is joined across a province border: each province is merged separately and chain
    ids are never combined (Review Focus 1).
    """

    def __init__(self) -> None:
        """Create an empty network."""
        self.dataset_version: str | None = None
        self._seen: dict[tuple[str, str], tuple[bytes, str]] = {}
        self._chains: dict[str, _Chain] = {}
        self._segments: dict[str, _Segment] = {}
        self._classes: dict[str, set[str]] = {}
        self._anchors: dict[tuple[str, str], list[Any]] = {}
        self._intervals: dict[str, list[Any]] = {}
        self._assets: dict[str, list[Any]] = {}
        self._details: dict[str, dict[str, Any]] = {}
        self._coverage: set[tuple[int, int, int, int]] = set()

    def _see(
        self, kind: str, ident: str, obj: object, province: str, local: set[tuple[str, str]]
    ) -> tuple[bool, bool]:
        """Record ``obj`` under ``(kind, ident)``; return ``(first in this province, new)``.

        Raises:
            PipelineError: ``MERGE_CONFLICT`` when the id was seen with different bytes.
        """
        key = (kind, ident)
        digest = _digest(obj)
        prior = self._seen.get(key)
        if prior is not None and prior[0] != digest:
            where = f"province {province}" if prior[1] == province else f"{prior[1]} and {province}"
            raise _conflict(f"{kind} {ident!r} differs between tiles or provinces ({where})")
        first_local = key not in local
        local.add(key)
        if prior is None:
            self._seen[key] = (digest, province)
        return first_local, prior is None

    def add_tiles(self, province: str, tiles: Mapping[str, TileObj]) -> ProvinceCounts:
        """Merge the ``cantre.tile/1`` objects of ``province`` (tile key to tile) and count them.

        Raises:
            PipelineError: ``MERGE_CONFLICT`` on mixed dataset versions, a differing duplicate
                id, disagreeing chain pieces or a gap inside a chain.
        """
        local: set[tuple[str, str]] = set()
        pieces: dict[str, list[_Piece]] = {}
        n_seg = n_anchor = n_interval = n_asset = 0
        for key in sorted(tiles):
            tile = tiles[key]
            version = tile["datasetVersion"]
            if self.dataset_version is None:
                self.dataset_version = version
            elif version != self.dataset_version:
                raise _conflict(
                    f"tile {key} of {province} has datasetVersion {version!r}, "
                    f"expected {self.dataset_version!r}"
                )
            b = tile["bounds"]
            self._coverage.add(
                (to_e6(b["south"]), to_e6(b["west"]), to_e6(b["north"]), to_e6(b["east"]))
            )
            for c in tile["chains"]:
                pieces.setdefault(c["id"], []).append(
                    _Piece(
                        key,
                        c,
                        c["vertexStart"],
                        _absolute(c["latE6"]),
                        _absolute(c["lonE6"]),
                        _absolute(c["sMm"]),
                    )
                )
            for s in tile["segments"]:
                first, new = self._see("segment", s["key"], s, province, local)
                n_seg += first and s["chainId"] is None
                if s["chainId"] is not None:
                    self._classes.setdefault(s["chainId"], set()).add(s["trackClass"])
                elif new:
                    self._segments[s["key"]] = _Segment(
                        s["key"],
                        s["trackClass"],
                        s["status"],
                        s["subdivisionNid"],
                        s["subdivisionName"],
                        s["operator"],
                        s["geoAccuracyM"],
                        _absolute(s["latE6"]),
                        _absolute(s["lonE6"]),
                    )
            for a in tile["anchors"]:
                ident = f"{a['chainId']}/{a['id']}"
                first, new = self._see("anchor", ident, a, province, local)
                n_anchor += first
                if new:
                    self._anchors[(a["chainId"], a["id"])] = [
                        a["chainId"],
                        a["id"],
                        a["sMm"],
                        a["mp"],
                        a["source"],
                        a["tier"],
                    ]
            for v in tile["intervals"]:
                first, new = self._see("interval", v["id"], v, province, local)
                n_interval += first
                if new:
                    self._intervals[v["id"]] = [v["id"], v["chainId"], list(v["anchorIds"])]
            for a in tile["assets"]:
                first, new = self._see("asset", a["id"], a, province, local)
                n_asset += first
                if new:
                    self._assets[a["id"]] = _asset_record(a)
                    self._details[a["id"]] = {"layer": a["layer"], "attrs": a["attrs"]}
        n_vertices = 0
        for chain_id in sorted(pieces):
            chain = _merge_pieces(province, chain_id, pieces[chain_id])
            n_vertices += len(chain.s)
            prior = self._chains.get(chain_id)
            if prior is None:
                self._chains[chain_id] = chain
            elif not _same_chain(prior, chain):
                raise _conflict(f"chain {chain_id!r} differs between provinces")
        return ProvinceCounts(len(pieces), n_vertices, n_seg, n_anchor, n_interval, n_asset)

    def totals(self) -> ProvinceCounts:
        """National totals after de-duplication (same fields as :class:`ProvinceCounts`)."""
        return ProvinceCounts(
            len(self._chains),
            sum(len(c.s) for c in self._chains.values()),
            len(self._segments),
            len(self._anchors),
            len(self._intervals),
            len(self._assets),
        )


def _asset_record(a: TileObj) -> list[Any]:
    """The positional asset record of ``snapshot.md`` (layer and attrs go to the details file)."""
    p = a["posted"]
    return [
        a["id"],
        a["kind"],
        a["name"],
        None if p is None else [p["mp"], p["subdivisionNid"], p["tier"]],
        [
            [
                q["chainId"],
                q["sStartMm"],
                q["sEndMm"],
                q["residualMm"],
                q["derivedMpStart"],
                q["derivedMpEnd"],
            ]
            for q in a["positions"]
        ],
        list(a["latE6"]),
        list(a["lonE6"]),
    ]


def _same_chain(a: _Chain, b: _Chain) -> bool:
    return (a.id, a.sub_nid, a.sub_name, a.operators, a.cycle, a.lat, a.lon, a.s) == (
        b.id,
        b.sub_nid,
        b.sub_name,
        b.operators,
        b.cycle,
        b.lat,
        b.lon,
        b.s,
    )


def _merge_pieces(province: str, chain_id: str, pieces: list[_Piece]) -> _Chain:
    """Merge the pieces of one chain by ``vertexStart`` into one whole chain.

    Raises:
        PipelineError: ``MERGE_CONFLICT`` when the pieces disagree about the chain's attributes
            or about an overlapping vertex, or leave a gap in the vertex indices.
    """
    first = pieces[0].chain
    attrs = ("subdivisionNid", "subdivisionName", "operators", "cycle")
    for p in pieces:
        if any(p.chain[k] != first[k] for k in attrs):
            raise _conflict(f"chain {chain_id!r} has inconsistent attributes between tiles")
    lat: array[int] = array("q")
    lon: array[int] = array("q")
    s: array[int] = array("q")
    for p in sorted(pieces, key=lambda q: (q.start, q.tile)):
        if p.start > len(s):
            raise _conflict(
                f"chain {chain_id!r} of {province} has a gap before vertex {p.start} "
                f"(tile {p.tile}); a province's tiles must cover every chain"
            )
        for i in range(len(p.s)):
            slot = p.start + i
            if slot < len(s):
                if (lat[slot], lon[slot], s[slot]) != (p.lat[i], p.lon[i], p.s[i]):
                    raise _conflict(f"chain {chain_id!r} vertex {slot} differs between tiles")
            else:
                lat.append(p.lat[i])
                lon.append(p.lon[i])
                s.append(p.s[i])
    if not s:
        raise _conflict(f"chain {chain_id!r} of {province} has no vertices")
    return _Chain(
        chain_id,
        first["subdivisionNid"],
        first["subdivisionName"],
        list(first["operators"]),
        first["cycle"],
        lat,
        lon,
        s,
    )


# --- writing ----------------------------------------------------------------------------------


def _chain_record(c: _Chain, classes: Iterable[str]) -> list[Any]:
    return [c.id, c.sub_nid, c.sub_name, c.operators, c.cycle, sorted(classes)]


def _segment_record(s: _Segment) -> list[Any]:
    return [
        s.key,
        s.track_class,
        s.status,
        s.sub_nid,
        s.sub_name,
        s.operator,
        s.geo_accuracy_m,
    ]


def _geometry(chains: Sequence[_Chain], segments: Sequence[_Segment]) -> bytes:
    """The geometry stream: for each chain ``n`` then ``n`` triples, then each segment likewise.

    Every value is a zigzag LEB128 varint of the difference from the previous vertex (the first
    vertex from 0): microdegrees for latitude and longitude, millimetres for ``s``.
    """
    buf = bytearray()
    for c in chains:
        write_varint(buf, len(c.s))
        pl = po = ps = 0
        for la, lo, sm in zip(c.lat, c.lon, c.s, strict=True):
            write_varint(buf, la - pl)
            write_varint(buf, lo - po)
            write_varint(buf, sm - ps)
            pl, po, ps = la, lo, sm
    for sg in segments:
        write_varint(buf, len(sg.lat))
        pl = po = 0
        for la, lo in zip(sg.lat, sg.lon, strict=True):
            write_varint(buf, la - pl)
            write_varint(buf, lo - po)
            pl, po = la, lo
    return bytes(buf)


def encode_snapshot(
    net: NetworkMerger,
    *,
    snapshot_date: str,
    attribution: str,
    package_versions: Mapping[str, str],
) -> bytes:
    """Return the decompressed snapshot bytes (gzip them with :func:`gzip_bytes`).

    Layout (``pipeline/schema/snapshot.md`` is the contract): magic, version, ``u32`` length and
    meta JSON, ``u32`` length and records JSON, then the geometry stream to the end of the file.
    Record order: chains by id, unchained segments by key, anchors by ``(chainId, sMm, id)``,
    intervals by id, assets by id (all in code-point order); coverage cells by
    ``(south, west, north, east)``.

    Raises:
        ValueError: if no tile was merged (there is no dataset version) or a length does not fit
            a ``u32``.
    """
    if net.dataset_version is None:
        raise ValueError("cannot write a snapshot with no tiles")
    chains = [net._chains[i] for i in sorted(net._chains)]
    segments = [net._segments[k] for k in sorted(net._segments)]
    anchors = sorted(net._anchors.values(), key=lambda a: (a[0], a[2], a[1]))
    meta = {
        "datasetVersion": net.dataset_version,
        "snapshotDate": snapshot_date,
        "attribution": attribution,
        "packageVersions": dict(sorted(package_versions.items())),
        "coverage": [list(c) for c in sorted(net._coverage)],
    }
    records = {
        "chains": [_chain_record(c, net._classes.get(c.id, ())) for c in chains],
        "segments": [_segment_record(s) for s in segments],
        "anchors": anchors,
        "intervals": [net._intervals[i] for i in sorted(net._intervals)],
        "assets": [net._assets[i] for i in sorted(net._assets)],
    }
    meta_bytes, records_bytes = canonical_json(meta), canonical_json(records)
    for blob in (meta_bytes, records_bytes):
        if len(blob) >= 1 << 32:
            raise ValueError("snapshot JSON section does not fit a u32 length")
    return b"".join(
        (
            MAGIC,
            bytes([FORMAT_VERSION]),
            _U32.pack(len(meta_bytes)),
            meta_bytes,
            _U32.pack(len(records_bytes)),
            records_bytes,
            _geometry(chains, segments),
        )
    )


def encode_asset_details(net: NetworkMerger) -> bytes:
    """Return ``{assetId: {layer, attrs}}`` as canonical JSON (keys sorted, so by asset id)."""
    return canonical_json(net._details)


# --- reading (tests only) ---------------------------------------------------------------------


@dataclass
class Snapshot:
    """A decoded snapshot, in the shape of the tile objects it came from.

    Attributes:
        meta: The meta object.
        chains: Dicts with ``id``, ``subdivisionNid``, ``subdivisionName``, ``operators``,
            ``cycle``, ``trackClasses`` and absolute ``latE6``, ``lonE6``, ``sMm`` lists.
        segments: Dicts with ``key``, ``trackClass``, ``status``, ``subdivisionNid``,
            ``subdivisionName``, ``operator``, ``geoAccuracyM`` and absolute ``latE6``, ``lonE6``.
        anchors: Dicts with ``chainId``, ``id``, ``sMm``, ``mp``, ``source``, ``tier``.
        intervals: Dicts with ``id``, ``chainId``, ``anchorIds``.
        assets: Dicts with ``id``, ``kind``, ``name``, ``posted`` (dict or ``None``),
            ``positions`` (dicts) and ``latE6``, ``lonE6`` (delta encoded, as in the tile).
    """

    meta: dict[str, Any]
    chains: list[dict[str, Any]]
    segments: list[dict[str, Any]]
    anchors: list[dict[str, Any]]
    intervals: list[dict[str, Any]]
    assets: list[dict[str, Any]]


def _section(data: bytes, pos: int, what: str) -> tuple[Any, int]:
    """Read a ``u32`` length and the UTF-8 JSON that follows; return ``(object, next pos)``."""
    if pos + 4 > len(data):
        raise ValueError(f"snapshot ends before the {what} length")
    (length,) = _U32.unpack_from(data, pos)
    end = pos + 4 + length
    if end > len(data):
        raise ValueError(f"snapshot ends inside the {what} section")
    return json.loads(data[pos + 4 : end].decode("utf-8")), end


def read_snapshot(gz: bytes) -> Snapshot:
    """Decode a gzipped snapshot (test helper that mirrors ``snapshot.md``).

    Raises:
        ValueError: on a bad magic or version, a truncated section or geometry stream, or bytes
            left over after the geometry.
    """
    data = gzip.decompress(gz)
    if data[:4] != MAGIC:
        raise ValueError("not a CANTRE snapshot (bad magic)")
    if len(data) < 5 or data[4] != FORMAT_VERSION:
        raise ValueError(
            f"unsupported snapshot format version {data[4] if len(data) > 4 else None}"
        )
    meta, pos = _section(data, 5, "meta")
    rec, pos = _section(data, pos, "records")
    view = memoryview(data)
    chains: list[dict[str, Any]] = []
    for c in rec["chains"]:
        n, pos = read_varint(view, pos)
        lat, lon, s = [], [], []
        pl = po = ps = 0
        for _ in range(n):
            dl, pos = read_varint(view, pos)
            do, pos = read_varint(view, pos)
            ds, pos = read_varint(view, pos)
            pl, po, ps = pl + dl, po + do, ps + ds
            lat.append(pl)
            lon.append(po)
            s.append(ps)
        chains.append(
            {
                "id": c[0],
                "subdivisionNid": c[1],
                "subdivisionName": c[2],
                "operators": c[3],
                "cycle": c[4],
                "trackClasses": c[5],
                "latE6": lat,
                "lonE6": lon,
                "sMm": s,
            }
        )
    segments: list[dict[str, Any]] = []
    for g in rec["segments"]:
        n, pos = read_varint(view, pos)
        lat, lon = [], []
        pl = po = 0
        for _ in range(n):
            dl, pos = read_varint(view, pos)
            do, pos = read_varint(view, pos)
            pl, po = pl + dl, po + do
            lat.append(pl)
            lon.append(po)
        segments.append(
            {
                "key": g[0],
                "trackClass": g[1],
                "status": g[2],
                "subdivisionNid": g[3],
                "subdivisionName": g[4],
                "operator": g[5],
                "geoAccuracyM": g[6],
                "latE6": lat,
                "lonE6": lon,
            }
        )
    if pos != len(data):
        raise ValueError(f"{len(data) - pos} bytes left after the geometry stream")
    return Snapshot(
        meta,
        chains,
        segments,
        [
            dict(zip(("chainId", "id", "sMm", "mp", "source", "tier"), a, strict=True))
            for a in rec["anchors"]
        ],
        [dict(zip(("id", "chainId", "anchorIds"), v, strict=True)) for v in rec["intervals"]],
        [
            {
                "id": a[0],
                "kind": a[1],
                "name": a[2],
                "posted": None
                if a[3] is None
                else dict(zip(("mp", "subdivisionNid", "tier"), a[3], strict=True)),
                "positions": [
                    dict(
                        zip(
                            (
                                "chainId",
                                "sStartMm",
                                "sEndMm",
                                "residualMm",
                                "derivedMpStart",
                                "derivedMpEnd",
                            ),
                            q,
                            strict=True,
                        )
                    )
                    for q in a[4]
                ],
                "latE6": a[5],
                "lonE6": a[6],
            }
            for a in rec["assets"]
        ],
    )
