"""Tests for cantre_pipeline.reader and schema_nrwn: layer reading, schema/CRS checks, TC CSV."""

from pathlib import Path

import pytest

from cantre_pipeline.errors import PipelineError
from cantre_pipeline.geodesy import LatLon
from cantre_pipeline.reader import (
    TC_REQUIRED_COLUMNS,
    read_layer,
    read_tc_inventory,
    read_tc_inventory_full,
    tc_duplicate_audit,
)
from cantre_pipeline.schema_nrwn import (
    EXPECTED_SHAPE_TYPES,
    OPTIONAL_FIELDS,
    REQUIRED_FIELDS,
    norm_subdivision,
    parse_mileage,
)
from fixtures.builder import LAYER_FIELDS, NRWN_PRJ, WGS84_PRJ, NrwnFixture
from real_data import needs_real_sk, real_sk_paths

A = LatLon(52.0, -106.0)
B = LatLon(52.0, -105.99)


def _fx(tmp_path: Path) -> NrwnFixture:
    fx = NrwnFixture(tmp_path)
    fx.track("SEG1", [A, B])
    fx.crossing("X1", A, "SEG1", mp=3.5, tcid=77)
    fx.junction("J1", A, "Switch")
    return fx


def test_fixture_fields_equal_required_fields() -> None:
    assert {k: {f[0] for f in v} for k, v in LAYER_FIELDS.items()} == {
        k: set(v) | OPTIONAL_FIELDS.get(k, frozenset()) for k, v in REQUIRED_FIELDS.items()
    }


def test_expected_shape_types() -> None:
    assert EXPECTED_SHAPE_TYPES["TRACK"] == {3, 13}
    assert EXPECTED_SHAPE_TYPES["STRUCTURE_1"] == {3, 13}
    for layer in ("CROSSING", "STATION", "MARKERPOST", "STRUCTURE_0", "JUNCTION"):
        assert EXPECTED_SHAPE_TYPES[layer] == {1, 11}


def test_read_layer_returns_stripped_strings_and_lon_lat_parts(tmp_path: Path) -> None:
    raw = _fx(tmp_path).write()
    (track,) = read_layer(raw, "sk", "TRACK")
    assert track.index == 0
    assert track.attrs["TRACKSEGID"] == "SEG1"
    assert track.attrs["GEOACCURA"] == "10"
    assert track.parts == [[(-106.0, 52.0), (-105.99, 52.0)]]  # (lon, lat) as stored
    (x,) = read_layer(raw, "sk", "CROSSING")
    assert x.attrs["TCID"] == "77"
    assert x.parts == [[(-106.0, 52.0)]]


def test_missing_required_field_is_schema_drift(tmp_path: Path) -> None:
    fx = _fx(tmp_path)
    fx.drop_fields.add(("TRACK", "OPERATORMK"))
    raw = fx.write()
    with pytest.raises(PipelineError) as exc:
        read_layer(raw, "sk", "TRACK")
    assert exc.value.code == "SCHEMA_DRIFT"
    assert "OPERATORMK" in str(exc.value)


def test_missing_layer_file_is_schema_drift(tmp_path: Path) -> None:
    raw = _fx(tmp_path).write()
    for p in raw.glob("*_STATION.*"):
        p.unlink()
    with pytest.raises(PipelineError) as exc:
        read_layer(raw, "sk", "STATION")
    assert exc.value.code == "SCHEMA_DRIFT"


def test_unknown_layer_name_is_schema_drift(tmp_path: Path) -> None:
    raw = _fx(tmp_path).write()
    with pytest.raises(PipelineError) as exc:
        read_layer(raw, "sk", "NOPE")
    assert exc.value.code == "SCHEMA_DRIFT"


def test_wrong_crs_is_rejected(tmp_path: Path) -> None:
    fx = _fx(tmp_path)
    fx.prj_text = WGS84_PRJ
    with pytest.raises(PipelineError) as exc:
        read_layer(fx.write(), "sk", "TRACK")
    assert exc.value.code == "CRS_MISMATCH"


def test_missing_prj_is_crs_mismatch(tmp_path: Path) -> None:
    raw = _fx(tmp_path).write()
    next(raw.glob("*_TRACK.prj")).unlink()
    with pytest.raises(PipelineError) as exc:
        read_layer(raw, "sk", "TRACK")
    assert exc.value.code == "CRS_MISMATCH"


def test_prj_whitespace_is_normalised(tmp_path: Path) -> None:
    fx = _fx(tmp_path)
    fx.prj_text = "  " + NRWN_PRJ.replace(",", ",\r\n  ") + "\n"
    assert len(read_layer(fx.write(), "sk", "TRACK")) == 1


def test_unexpected_shape_type_is_schema_drift(tmp_path: Path) -> None:
    raw = _fx(tmp_path).write()
    # Swap the CROSSING (point) files for the TRACK (polyline) ones: right fields are absent too,
    # so use a layer pair with the same fields instead: STRUCTURE_1 (line) read as a point layer.
    for ext in ("shp", "shx", "dbf", "prj"):
        (raw / f"NRWN_SK_2_0_STRUCTURE_0.{ext}").write_bytes(
            (raw / f"NRWN_SK_2_0_STRUCTURE_1.{ext}").read_bytes()
        )
    with pytest.raises(PipelineError) as exc:
        read_layer(raw, "sk", "STRUCTURE_0")
    assert exc.value.code == "SCHEMA_DRIFT"
    assert "shape type" in str(exc.value)


def test_null_and_multipart_shapes_read_as_empty_and_multi(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("N", None)
    fx.track("M", [A, B], extra_parts=[[B, LatLon(52.0, -105.98)]])
    nul, multi = read_layer(fx.write(), "sk", "TRACK")
    assert nul.parts == []
    assert len(multi.parts) == 2


def test_empty_layer_reads_as_empty_list(tmp_path: Path) -> None:
    raw = NrwnFixture(tmp_path).write()
    assert read_layer(raw, "sk", "TRACK") == []


def test_parse_mileage_sentinels() -> None:
    assert [parse_mileage(v) for v in ["12.34", "0.00", "-1.00", "", "None", "x", "-0.5"]] == [
        12.34,
        0.0,
        None,
        None,
        None,
        None,
        None,
    ]
    assert parse_mileage(" 7 ") == 7.0
    assert parse_mileage("-1") is None
    assert parse_mileage("nan") is None
    assert parse_mileage("inf") is None


def test_norm_subdivision() -> None:
    assert norm_subdivision("Kingston - CN") == norm_subdivision("Kingston") == "kingston"
    assert norm_subdivision("Indian Head") == "indianhead"
    assert norm_subdivision("  QU'Appelle - CP ") == "quappelle"
    assert norm_subdivision("Sub-Division") == "subdivision"  # only a spaced " - word" is a suffix


def test_tc_inventory_reads_province_rows(tmp_path: Path) -> None:
    fx = _fx(tmp_path)
    fx.tc_row(77, mile=3.5, subdivision="Alpha - CN", railway="CN")
    fx.tc_row(88, mile="bad", subdivision="Alpha", spur_mile_point="2.1")
    fx.tc_row(99, mile=1.0, subdivision="Alberta", province="AB")
    fx.write()
    rows = read_tc_inventory(fx.tc_path, "sk")
    assert sorted(rows) == ["77", "88"]
    assert rows["77"].mile == 3.5
    assert rows["77"].subdivision == "Alpha - CN"
    assert rows["77"].railway == "CN"
    assert rows["77"].province == "SK"
    assert rows["88"].mile is None
    assert rows["88"].spur_mile_point == "2.1"


def test_tc_inventory_header_drift_and_duplicate_numbers(tmp_path: Path) -> None:
    fx = _fx(tmp_path)
    fx.tc_row(5, mile=1.0, subdivision="Alpha")
    fx.tc_row(5, mile=2.0, subdivision="Alpha")
    fx.tc_row(6, mile=3.0, subdivision="Alpha")
    fx.write()
    inv = read_tc_inventory_full(fx.tc_path, "SK")
    assert sorted(inv.rows) == ["6"]  # the repeated number is used for neither record
    assert inv.duplicates == {"5": 2}
    audit = tc_duplicate_audit(inv)
    assert [(a.layer, a.nid, a.reason, a.severity) for a in audit] == [
        ("TC", "5", "TC_DUPLICATE_NUMBER", "info")
    ]
    assert read_tc_inventory(fx.tc_path, "sk").keys() == {"6"}

    fx.drop_tc_columns.add("Spur Mile Point")
    fx.write()
    with pytest.raises(PipelineError) as exc:
        read_tc_inventory(fx.tc_path, "sk")
    assert exc.value.code == "SCHEMA_DRIFT"
    assert "Spur Mile Point" in str(exc.value)


def test_tc_empty_file_is_schema_drift(tmp_path: Path) -> None:
    p = tmp_path / "empty.csv"
    p.write_bytes(b"")
    with pytest.raises(PipelineError) as exc:
        read_tc_inventory(p, "sk")
    assert exc.value.code == "SCHEMA_DRIFT"


def test_tc_required_columns_are_the_nine_documented() -> None:
    assert set(TC_REQUIRED_COLUMNS) == {
        "TC Number",
        "Province",
        "Mile",
        "Subdivision",
        "Spur Mile Point",
        "Spur Name",
        "Railway Company",
        "Latitude",
        "Longitude",
    }


@needs_real_sk
def test_reads_real_layer_shapes_when_raw_dir_set() -> None:
    shp_dir, csv_path = real_sk_paths()
    track = read_layer(shp_dir, "sk", "TRACK")
    assert len(track) == 7084
    assert {len(f.parts) for f in track} == {1}
    for layer, n in {
        "CROSSING": 7660,
        "STATION": 256,
        "MARKERPOST": 2430,
        "STRUCTURE_0": 4,
        "STRUCTURE_1": 451,
        "JUNCTION": 5163,
    }.items():
        assert len(read_layer(shp_dir, "sk", layer)) == n
    assert len(read_tc_inventory(csv_path, "SK")) >= 4700  # 4,744 rows less repeated numbers
