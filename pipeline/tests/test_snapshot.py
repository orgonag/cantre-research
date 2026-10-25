"""Tests for cantre_pipeline.snapshot: varints, tile merging, the byte layout (M4 Task 2)."""

import gzip
import json
import struct
from collections.abc import Iterator
from typing import Any

import pytest

from cantre_pipeline.encode import canonical_json, delta_decode
from cantre_pipeline.errors import PipelineError
from cantre_pipeline.snapshot import (
    FORMAT_VERSION,
    MAGIC,
    VARINT_MAX,
    VARINT_MIN,
    NetworkMerger,
    encode_asset_details,
    encode_snapshot,
    gzip_bytes,
    read_snapshot,
    read_varint,
    write_varint,
)
from cantre_pipeline.tiles import ATTRIBUTION
from fixtures.synthetic import build_synthetic

Tiles = dict[str, dict[str, Any]]


# --- varints ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "n",
    [0, 1, -1, 2, -2, 63, -64, 64, -65, 2**31, -(2**31), 2**40, -(2**40), VARINT_MAX, VARINT_MIN],
)
def test_varint_zigzag(n: int) -> None:
    buf = bytearray()
    write_varint(buf, n)
    assert read_varint(bytes(buf), 0) == (n, len(buf))


def test_varint_known_bytes() -> None:
    # zigzag: 0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3; LEB128 of 300 is AC 02 (zigzag of 150).
    for n, expected in [
        (0, b"\x00"),
        (-1, b"\x01"),
        (1, b"\x02"),
        (-2, b"\x03"),
        (150, b"\xac\x02"),
    ]:
        buf = bytearray()
        write_varint(buf, n)
        assert bytes(buf) == expected


def test_varint_sequence_and_offsets() -> None:
    values = [0, -7, 123456789, -(2**40), 5]
    buf = bytearray()
    for v in values:
        write_varint(buf, v)
    pos, out = 0, []
    for _ in values:
        v, pos = read_varint(bytes(buf), pos)
        out.append(v)
    assert out == values
    assert pos == len(buf)


@pytest.mark.parametrize("n", [VARINT_MAX + 1, VARINT_MIN - 1, 2**60])
def test_varint_rejects_values_outside_the_exact_range(n: int) -> None:
    with pytest.raises(ValueError, match="outside"):
        write_varint(bytearray(), n)


def test_varint_rejects_truncated_and_overlong() -> None:
    with pytest.raises(ValueError, match="ends inside"):
        read_varint(b"\x80", 0)
    with pytest.raises(ValueError, match="longer than 8"):
        read_varint(b"\x80" * 9 + b"\x00", 0)


# --- gzip -------------------------------------------------------------------------------------


def test_gzip_header_has_no_time_and_no_name() -> None:
    gz = gzip_bytes(b"hello" * 100)
    assert gz[:2] == b"\x1f\x8b"
    assert gz[3] == 0  # FLG: no FNAME, FEXTRA, FCOMMENT or FHCRC
    assert gz[4:8] == b"\x00\x00\x00\x00"  # MTIME
    assert gzip.decompress(gz) == b"hello" * 100
    assert gz == gzip_bytes(b"hello" * 100)


# --- merging ----------------------------------------------------------------------------------

BOUNDS = {"south": 52.0, "west": -106.0, "north": 52.25, "east": -105.5}


def deltas(xs: list[int]) -> list[int]:
    return [x - (xs[i - 1] if i else 0) for i, x in enumerate(xs)]


def piece(
    cid: str, start: int, lat: list[int], lon: list[int], s: list[int], **over: Any
) -> dict[str, Any]:
    return {
        "id": cid,
        "subdivisionNid": "S1",
        "subdivisionName": "Alpha",
        "operators": ["CN"],
        "cycle": False,
        "vertexStart": start,
        "latE6": deltas(lat),
        "lonE6": deltas(lon),
        "sMm": deltas(s),
        **over,
    }


def tile(key: str = "1_1", version: str = "v1", **parts: Any) -> dict[str, Any]:
    return {
        "schema": "cantre.tile/1",
        "datasetVersion": version,
        "key": key,
        "bounds": BOUNDS,
        "chains": [],
        "segments": [],
        "anchors": [],
        "intervals": [],
        "assets": [],
        **parts,
    }


def asset(aid: str = "a1", name: str = "n", **over: Any) -> dict[str, Any]:
    return {
        "id": aid,
        "kind": "crossing",
        "layer": "CROSSING",
        "name": name,
        "latE6": [52_100_000],
        "lonE6": [-105_900_000],
        "posted": None,
        "positions": [],
        "attrs": {"k": "v"},
        **over,
    }


def segment(key: str = "g1", **over: Any) -> dict[str, Any]:
    return {
        "key": key,
        "nid": key,
        "trackClass": "Siding",
        "status": "Operational",
        "subdivisionNid": "S1",
        "subdivisionName": "Alpha",
        "operator": "CN",
        "owner": "o",
        "useType": "u",
        "trackName": "t",
        "geoAccuracyM": 10,
        "chainId": None,
        "latE6": [52_100_000, 100],
        "lonE6": [-105_900_000, 200],
        **over,
    }


def test_pieces_from_two_tiles_make_one_whole_chain() -> None:
    lat, lon, s = [10, 20, 30, 40, 50], [5, 6, 7, 8, 9], [0, 100, 250, 400, 1000]
    a = tile("1_1", chains=[piece("c", 0, lat[:3], lon[:3], s[:3])])
    b = tile("1_2", chains=[piece("c", 2, lat[2:], lon[2:], s[2:])])  # shares vertex 2
    net = NetworkMerger()
    counts = net.add_tiles("sk", {"1_1": a, "1_2": b})
    assert (counts.chains, counts.vertices) == (1, 5)
    snap = read_snapshot(gzip_bytes(encode_snapshot(net, **META)))
    assert snap.chains[0]["latE6"] == lat
    assert snap.chains[0]["lonE6"] == lon
    assert snap.chains[0]["sMm"] == s


META: dict[str, Any] = {
    "snapshot_date": "2026-01-01",
    "attribution": ATTRIBUTION,
    "package_versions": {"sk": "2.0"},
}


def test_gap_between_pieces_is_an_error_never_bridged() -> None:
    a = tile("1_1", chains=[piece("c", 0, [1, 2], [1, 2], [0, 1])])
    b = tile("1_2", chains=[piece("c", 3, [4, 5], [4, 5], [3, 4])])  # vertex 2 is missing
    with pytest.raises(PipelineError, match="gap") as err:
        NetworkMerger().add_tiles("sk", {"1_1": a, "1_2": b})
    assert err.value.code == "MERGE_CONFLICT"
    assert "'c'" in str(err.value)


def test_overlapping_vertices_that_disagree_are_an_error() -> None:
    a = tile("1_1", chains=[piece("c", 0, [1, 2, 3], [1, 2, 3], [0, 1, 2])])
    b = tile("1_2", chains=[piece("c", 2, [99, 4], [3, 4], [2, 3])])
    with pytest.raises(PipelineError, match="vertex 2") as err:
        NetworkMerger().add_tiles("sk", {"1_1": a, "1_2": b})
    assert err.value.code == "MERGE_CONFLICT"


def test_pieces_with_different_attributes_are_an_error() -> None:
    a = tile("1_1", chains=[piece("c", 0, [1, 2], [1, 2], [0, 1])])
    b = tile("1_2", chains=[piece("c", 1, [2, 3], [2, 3], [1, 2], subdivisionName="Other")])
    with pytest.raises(PipelineError, match="inconsistent"):
        NetworkMerger().add_tiles("sk", {"1_1": a, "1_2": b})


def test_chain_must_start_at_vertex_zero() -> None:
    a = tile("1_1", chains=[piece("c", 1, [2, 3], [2, 3], [1, 2])])
    with pytest.raises(PipelineError, match="gap"):
        NetworkMerger().add_tiles("sk", {"1_1": a})


def test_equal_duplicates_across_tiles_and_provinces_are_kept_once() -> None:
    seg = segment()
    one = tile("1_1", segments=[seg], assets=[asset()])
    two = tile("1_2", segments=[seg], assets=[asset()])  # buffer overlap inside a province
    net = NetworkMerger()
    sk = net.add_tiles("sk", {"1_1": one, "1_2": two})
    ab = net.add_tiles("ab", {"1_1": tile("1_1", segments=[seg], assets=[asset()])})
    assert (sk.segments, sk.assets) == (1, 1)  # counted once inside a province
    assert (ab.segments, ab.assets) == (1, 1)  # and again for the province that shares it
    totals = net.totals()
    assert (totals.segments, totals.assets) == (1, 1)  # but once nationally
    assert len(read_snapshot(gzip_bytes(encode_snapshot(net, **META))).meta["coverage"]) == 1


@pytest.mark.parametrize(
    ("kind", "make", "needle"),
    [
        ("asset", lambda n: {"assets": [asset("A-9", name=n)]}, "A-9"),
        ("segment", lambda n: {"segments": [segment("G-7", status=n)]}, "G-7"),
        (
            "anchor",
            lambda n: {
                "anchors": [
                    {
                        "id": "an1",
                        "chainId": "c",
                        "sMm": 5,
                        "mp": 1.0 if n == "x" else 2.0,
                        "source": "crossing",
                        "tier": "posted",
                        "memberNids": [],
                    }
                ]
            },
            "an1",
        ),
        (
            "interval",
            lambda n: {
                "intervals": [{"id": "iv-3", "chainId": "c", "anchorIds": ["a", n]}],
            },
            "iv-3",
        ),
    ],
)
def test_differing_duplicate_id_fails_naming_the_id(kind: str, make: Any, needle: str) -> None:
    net = NetworkMerger()
    net.add_tiles("sk", {"1_1": tile(**make("x"))})
    with pytest.raises(PipelineError) as err:
        net.add_tiles("ab", {"1_1": tile(**make("y"))})
    assert err.value.code == "MERGE_CONFLICT"
    assert needle in str(err.value)
    assert kind in str(err.value)
    assert "sk and ab" in str(err.value)


def test_differing_duplicate_inside_one_province_fails() -> None:
    a = tile("1_1", assets=[asset("A-1", name="x")])
    b = tile("1_2", assets=[asset("A-1", name="y")])
    with pytest.raises(PipelineError, match="province sk"):
        NetworkMerger().add_tiles("sk", {"1_1": a, "1_2": b})


def test_the_same_chain_id_in_two_provinces_must_be_equal() -> None:
    net = NetworkMerger()
    p = piece("c", 0, [1, 2], [1, 2], [0, 1])
    net.add_tiles("sk", {"1_1": tile(chains=[p])})
    net.add_tiles("ab", {"1_1": tile(chains=[p])})  # equal: fine
    other = piece("c", 0, [1, 3], [1, 2], [0, 1])
    with pytest.raises(PipelineError, match="chain 'c'"):
        net.add_tiles("mb", {"1_1": tile(chains=[other])})


def test_mixed_dataset_versions_are_rejected() -> None:
    net = NetworkMerger()
    net.add_tiles("sk", {"1_1": tile(version="v1")})
    with pytest.raises(PipelineError, match="datasetVersion"):
        net.add_tiles("ab", {"1_1": tile(version="v2")})


def test_anchor_ids_are_unique_per_chain_only() -> None:
    def anchor(chain: str) -> dict[str, Any]:
        return {
            "id": "a1",
            "chainId": chain,
            "sMm": 1,
            "mp": 1.0,
            "source": "crossing",
            "tier": "posted",
            "memberNids": [],
        }

    net = NetworkMerger()
    net.add_tiles("sk", {"1_1": tile(anchors=[anchor("c1"), anchor("c2")])})
    assert net.totals().anchors == 2


def test_empty_network_cannot_be_encoded() -> None:
    with pytest.raises(ValueError, match="no tiles"):
        encode_snapshot(NetworkMerger(), **META)


def test_coverage_is_sorted_unique_and_in_microdegrees() -> None:
    def cell(south: float, west: float) -> dict[str, Any]:
        return tile(
            bounds={"south": south, "west": west, "north": south + 0.25, "east": west + 0.5}
        )

    net = NetworkMerger()
    net.add_tiles("sk", {"b": cell(52.25, -106.0), "a": cell(52.0, -106.0)})
    net.add_tiles("ab", {"c": cell(52.0, -106.0), "d": cell(52.0, -106.5)})
    cov = read_snapshot(gzip_bytes(encode_snapshot(net, **META))).meta["coverage"]
    assert cov == [
        [52_000_000, -106_500_000, 52_250_000, -106_000_000],
        [52_000_000, -106_000_000, 52_250_000, -105_500_000],
        [52_250_000, -106_000_000, 52_500_000, -105_500_000],
    ]


# --- layout -----------------------------------------------------------------------------------


def small_network() -> NetworkMerger:
    net = NetworkMerger()
    net.add_tiles(
        "sk",
        {
            "1_1": tile(
                chains=[
                    piece("c", 0, [52_100_000, 52_100_010], [-105_900_000, -105_899_000], [0, 700])
                ],
                segments=[segment(), segment("g0", chainId="c", trackClass="Main")],
                assets=[asset()],
            )
        },
    )
    return net


def test_layout_matches_the_documented_bytes() -> None:
    data = encode_snapshot(small_network(), **META)
    assert data[:4] == MAGIC == b"CNTS"
    assert data[4] == FORMAT_VERSION == 1
    (meta_len,) = struct.unpack_from("<I", data, 5)
    meta = json.loads(data[9 : 9 + meta_len])
    assert meta == {
        "datasetVersion": "v1",
        "snapshotDate": "2026-01-01",
        "attribution": ATTRIBUTION,
        "packageVersions": {"sk": "2.0"},
        "coverage": [[52_000_000, -106_000_000, 52_250_000, -105_500_000]],
    }
    assert data[9 : 9 + meta_len] == canonical_json(meta)
    pos = 9 + meta_len
    (rec_len,) = struct.unpack_from("<I", data, pos)
    records = json.loads(data[pos + 4 : pos + 4 + rec_len])
    assert records["chains"] == [["c", "S1", "Alpha", ["CN"], False, ["Main"]]]
    assert records["segments"] == [["g1", "Siding", "Operational", "S1", "Alpha", "CN", 10]]
    assert records["assets"] == [["a1", "crossing", "n", None, [], [52_100_000], [-105_900_000]]]
    geometry = data[pos + 4 + rec_len :]
    expected = bytearray()
    for n in (2, 52_100_000, -105_900_000, 0, 10, 1000, 700):
        write_varint(expected, n)
    for n in (2, 52_100_000, -105_900_000, 100, 200):
        write_varint(expected, n)
    assert geometry == bytes(expected)


def test_encode_is_deterministic_and_independent_of_merge_order() -> None:
    a = tile("1_1", assets=[asset("a1"), asset("a2")], segments=[segment("g2"), segment("g1")])
    b = tile("1_2", assets=[asset("a3")], segments=[segment("g3")])
    n1, n2 = NetworkMerger(), NetworkMerger()
    n1.add_tiles("sk", {"1_1": a})
    n1.add_tiles("ab", {"1_2": b})
    n2.add_tiles("ab", {"1_2": b})
    n2.add_tiles("sk", {"1_1": a})
    assert gzip_bytes(encode_snapshot(n1, **META)) == gzip_bytes(encode_snapshot(n2, **META))
    assert encode_asset_details(n1) == encode_asset_details(n2)


def test_asset_details_are_sorted_by_id_with_layer_and_attrs() -> None:
    net = NetworkMerger()
    net.add_tiles("sk", {"1_1": tile(assets=[asset("b"), asset("a", attrs={"z": "1", "a": "2"})])})
    raw = encode_asset_details(net)
    assert raw == canonical_json(
        {
            "a": {"layer": "CROSSING", "attrs": {"a": "2", "z": "1"}},
            "b": {"layer": "CROSSING", "attrs": {"k": "v"}},
        }
    )
    assert list(json.loads(raw)) == ["a", "b"]


def test_reader_rejects_bad_input() -> None:
    good = encode_snapshot(small_network(), **META)
    with pytest.raises(ValueError, match="magic"):
        read_snapshot(gzip.compress(b"XXXX" + good[4:]))
    with pytest.raises(ValueError, match="version"):
        read_snapshot(gzip.compress(good[:4] + b"\x02" + good[5:]))
    with pytest.raises(ValueError, match="left after"):
        read_snapshot(gzip.compress(good + b"\x00"))
    with pytest.raises(ValueError, match="ends inside a varint"):
        read_snapshot(gzip.compress(good[:-1] + b"\x80"))
    with pytest.raises(ValueError, match="meta"):
        read_snapshot(gzip.compress(good[:7]))
    with pytest.raises(ValueError, match="records"):
        read_snapshot(gzip.compress(good[: 9 + struct.unpack_from("<I", good, 5)[0] + 6]))
    with pytest.raises(ValueError, match="before the records length"):
        read_snapshot(gzip.compress(good[: 9 + struct.unpack_from("<I", good, 5)[0]]))


# --- the synthetic network round trip ---------------------------------------------------------


@pytest.fixture(scope="module")
def golden_tiles(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Tiles]:
    out = tmp_path_factory.mktemp("syn")
    yield build_synthetic(out).tiles


def expected_chains(tiles: Tiles) -> list[dict[str, Any]]:
    """Chains rebuilt straight from the tile pieces, independently of the merger."""
    verts: dict[str, dict[int, tuple[int, int, int]]] = {}
    meta: dict[str, dict[str, Any]] = {}
    for t in tiles.values():
        for c in t["chains"]:
            meta[c["id"]] = c
            slots = verts.setdefault(c["id"], {})
            lat, lon, s = delta_decode(c["latE6"]), delta_decode(c["lonE6"]), delta_decode(c["sMm"])
            for i, v in enumerate(zip(lat, lon, s, strict=True)):
                assert slots.setdefault(c["vertexStart"] + i, v) == v
    classes: dict[str, set[str]] = {}
    for t in tiles.values():
        for sg in t["segments"]:
            if sg["chainId"] is not None:
                classes.setdefault(sg["chainId"], set()).add(sg["trackClass"])
    out = []
    for cid in sorted(verts):
        slots = verts[cid]
        assert sorted(slots) == list(range(len(slots)))
        vs = [slots[i] for i in range(len(slots))]
        c = meta[cid]
        out.append(
            {
                "id": cid,
                "subdivisionNid": c["subdivisionNid"],
                "subdivisionName": c["subdivisionName"],
                "operators": c["operators"],
                "cycle": c["cycle"],
                "trackClasses": sorted(classes.get(cid, ())),
                "latE6": [v[0] for v in vs],
                "lonE6": [v[1] for v in vs],
                "sMm": [v[2] for v in vs],
            }
        )
    return out


def unique(items: list[dict[str, Any]], key: Any) -> dict[Any, dict[str, Any]]:
    out: dict[Any, dict[str, Any]] = {}
    for it in items:
        assert out.setdefault(key(it), it) == it  # a duplicate must be equal
    return out


def test_snapshot_round_trips_tiles(golden_tiles: Tiles) -> None:
    net = NetworkMerger()
    net.add_tiles("sk", golden_tiles)
    snap = read_snapshot(gzip_bytes(encode_snapshot(net, **META)))
    every = list(golden_tiles.values())
    assert snap.chains == expected_chains(golden_tiles)
    assert len(snap.chains) > 5
    assert any(len(c["sMm"]) > 2 for c in snap.chains)

    segs = unique(
        [s for t in every for s in t["segments"] if s["chainId"] is None], lambda s: s["key"]
    )
    assert snap.segments == [
        {
            "key": s["key"],
            "trackClass": s["trackClass"],
            "status": s["status"],
            "subdivisionNid": s["subdivisionNid"],
            "subdivisionName": s["subdivisionName"],
            "operator": s["operator"],
            "geoAccuracyM": s["geoAccuracyM"],
            "latE6": delta_decode(s["latE6"]),
            "lonE6": delta_decode(s["lonE6"]),
        }
        for _, s in sorted(segs.items())
    ]
    assert snap.segments

    anchors = unique([a for t in every for a in t["anchors"]], lambda a: (a["chainId"], a["id"]))
    assert snap.anchors == [
        {k: a[k] for k in ("chainId", "id", "sMm", "mp", "source", "tier")}
        for a in sorted(anchors.values(), key=lambda a: (a["chainId"], a["sMm"], a["id"]))
    ]
    assert {a["tier"] for a in snap.anchors} == {"posted", "tc", "unverified"}

    ivs = unique([v for t in every for v in t["intervals"]], lambda v: v["id"])
    assert snap.intervals == [ivs[k] for k in sorted(ivs)]

    assets = unique([a for t in every for a in t["assets"]], lambda a: a["id"])
    assert snap.assets == [
        {k: assets[i][k] for k in ("id", "kind", "name", "posted", "positions", "latE6", "lonE6")}
        for i in sorted(assets)
    ]
    assert {a["kind"] for a in snap.assets} >= {"crossing", "bridge", "culvert", "diamond"}

    # Integers are equal with no rounding, and mileposts keep the tile's own floats.
    mp_tiles = sorted(a["mp"] for a in anchors.values())
    assert sorted(a["mp"] for a in snap.anchors) == mp_tiles
    assert snap.meta["datasetVersion"] == every[0]["datasetVersion"]
    details = json.loads(encode_asset_details(net))
    assert sorted(details) == sorted(assets)
    assert all(set(v) == {"layer", "attrs"} for v in details.values())


def test_snapshot_deterministic(golden_tiles: Tiles) -> None:
    def run(order: list[str]) -> tuple[bytes, bytes]:
        net = NetworkMerger()
        net.add_tiles("sk", {k: golden_tiles[k] for k in order})
        return gzip_bytes(encode_snapshot(net, **META)), gzip_bytes(encode_asset_details(net))

    keys = sorted(golden_tiles)
    first = run(keys)
    assert run(keys) == first
    assert run(keys[::-1]) == first


def test_tile_overlaps_are_removed(golden_tiles: Tiles) -> None:
    net = NetworkMerger()
    counts = net.add_tiles("sk", golden_tiles)
    total_pieces = sum(len(t["chains"]) for t in golden_tiles.values())
    assert counts.chains < total_pieces  # at least one chain spans two tiles
    snap = read_snapshot(gzip_bytes(encode_snapshot(net, **META)))
    assert counts.chains == len(snap.chains)
    assert counts.vertices == sum(len(c["sMm"]) for c in snap.chains)
    ids = [a["id"] for a in snap.assets]
    assert len(ids) == len(set(ids))
    assert counts.assets == len(ids)


def test_modest_size(golden_tiles: Tiles) -> None:
    net = NetworkMerger()
    net.add_tiles("sk", golden_tiles)
    raw = encode_snapshot(net, **META)
    tiles_json = sum(len(canonical_json(t)) for t in golden_tiles.values())
    assert len(raw) < tiles_json  # merging and varints are leaner than the tiles
