"""Read NRWN shapefile layers and the Transport Canada crossing inventory CSV.

Both readers are strict: a missing file, field, column, shape type or a different CRS stops the
build (``PipelineError``) because a changed publisher schema must never be guessed at (spec
section 5). Neither reader repairs, drops or interprets values; that is :mod:`validate`'s job.

DBF encoding. NRWN DBF files are read as Latin-1 (``encoding="latin-1"``). Checked on 2026-10-24
against the SK 2.0 package: the language-driver byte (offset 29 of each ``.dbf`` header) is 87
(0x57, "ANSI"), the Windows code-page family that Latin-1 is a subset of; and no ``.dbf`` has a
byte above 0x7F in its record area (the only high bytes sit in the field-descriptor table, where
they are field lengths, for example CROSSTYPNM = 250), so the SK text is pure ASCII and
Latin-1 decoding is lossless there. Latin-1 maps every byte to a character, so a province that
did contain accents (NRWN French names) would decode without error, as cp1252 text would.

Transport Canada ``Mile``. The inventory's own data dictionary
(``grade_crossing_inventory_data_dictionary.xls``, resource 594a421b-e1d2-4cf2-b71c-ac7689338f25)
was fetched on 2026-10-24. It is a legacy binary .xls and no spreadsheet reader is installed, so
it was searched as raw strings, not opened as a sheet. The string that sits with the ``Mile``
column heading reads: "Railway's addressing scheme - miles from the start of the subdivision"
(its dash is an en dash in the source). ``Spur Mile Point`` is described as "miles from the
start of the spur". That supports reading ``Mile`` as miles along the subdivision; the column
to sheet-row pairing was inferred from string order, not from cell coordinates, so treat the
citation as strong but not cell-verified.
"""

import csv
from dataclasses import dataclass
from pathlib import Path

import shapefile  # type: ignore[import-untyped,unused-ignore]

from cantre_pipeline.audit import AuditRecord
from cantre_pipeline.errors import PipelineError
from cantre_pipeline.schema_nrwn import (
    EXPECTED_PRJ,
    EXPECTED_SHAPE_TYPES,
    REQUIRED_FIELDS,
    norm_subdivision,
    normalise_wkt,
    parse_mileage,
)

__all__ = [
    "TC_REQUIRED_COLUMNS",
    "RawFeature",
    "TcCrossing",
    "TcInventory",
    "norm_subdivision",
    "read_layer",
    "read_tc_inventory",
    "read_tc_inventory_full",
    "tc_duplicate_audit",
]


@dataclass(frozen=True)
class RawFeature:
    """One shapefile record before validation.

    Attributes:
        index: Zero-based position in the file.
        attrs: Every DBF field as a stripped string (``None`` becomes ``""``).
        parts: Geometry parts as ``(lon, lat)`` tuples, exactly as stored (Z/M dropped). Empty
            list for a null shape; a point layer gives one part of one vertex.
    """

    index: int
    attrs: dict[str, str]
    parts: list[list[tuple[float, float]]]


def _layer_base(directory: Path, province: str, layer: str) -> Path:
    """Return the path of ``NRWN_<PR>_<version>_<LAYER>`` without extension (must be unique)."""
    if layer not in REQUIRED_FIELDS:
        raise PipelineError("SCHEMA_DRIFT", f"unknown NRWN layer {layer!r}")
    found = sorted(directory.glob(f"NRWN_{province.upper()}_*_{layer}.shp"))
    if len(found) != 1:
        raise PipelineError(
            "SCHEMA_DRIFT",
            f"expected exactly one NRWN_{province.upper()}_*_{layer}.shp in {directory}, "
            f"found {len(found)}",
        )
    return found[0].with_suffix("")


def _check_crs(base: Path) -> None:
    """Require the sibling ``.prj`` to equal :data:`EXPECTED_PRJ` (whitespace ignored)."""
    prj = base.with_suffix(".prj")
    if not prj.is_file():
        raise PipelineError("CRS_MISMATCH", f"{prj.name} is missing; CRS cannot be verified")
    text = prj.read_text(encoding="utf-8", errors="replace")
    if normalise_wkt(text) != normalise_wkt(EXPECTED_PRJ):
        raise PipelineError(
            "CRS_MISMATCH",
            f"{prj.name} is not NAD83(CSRS98) geographic (GRS80); got {text.strip()[:120]!r}",
        )


def _parts(shape: shapefile.Shape) -> list[list[tuple[float, float]]]:
    """Split a pyshp shape into parts of ``(x, y)`` vertices; Z and M values are ignored."""
    if shape.shapeType == shapefile.NULL or not shape.points:
        return []
    pts = [(float(p[0]), float(p[1])) for p in shape.points]
    if shape.shapeType in (shapefile.POINT, shapefile.POINTZ, shapefile.POINTM):
        return [pts]
    starts = list(shape.parts) or [0]
    ends = [*starts[1:], len(pts)]
    return [pts[a:b] for a, b in zip(starts, ends, strict=True)]


def read_layer(directory: Path, province: str, layer: str) -> list[RawFeature]:
    """Read one NRWN layer from ``directory`` (files ``NRWN_<PR>_*_<LAYER>.shp/.dbf/.prj``).

    Checks, in order, each fatal: the layer file exists exactly once; the ``.prj`` equals the
    NAD83(CSRS98) text (``CRS_MISMATCH``); the shape type is in ``EXPECTED_SHAPE_TYPES``; every
    field in ``REQUIRED_FIELDS`` is present; the shape and record counts agree (all
    ``SCHEMA_DRIFT``). Attributes are stripped strings, coordinates are ``(lon, lat)`` degrees
    as stored (no datum transformation, spec section 3). Latin-1 DBF decoding: see module note.

    Raises:
        PipelineError: ``SCHEMA_DRIFT`` or ``CRS_MISMATCH`` as described.
    """
    base = _layer_base(directory, province, layer)
    _check_crs(base)
    with shapefile.Reader(str(base), encoding="latin-1") as rdr:
        if rdr.shapeType not in EXPECTED_SHAPE_TYPES[layer]:
            raise PipelineError(
                "SCHEMA_DRIFT",
                f"{layer}: shape type {rdr.shapeType} not in {sorted(EXPECTED_SHAPE_TYPES[layer])}",
            )
        names = [f.name for f in rdr.fields if f.name != "DeletionFlag"]
        missing = sorted(REQUIRED_FIELDS[layer] - set(names))
        if missing:
            raise PipelineError("SCHEMA_DRIFT", f"{layer}: missing required fields {missing}")
        if rdr.numShapes != rdr.numRecords:
            raise PipelineError(
                "SCHEMA_DRIFT",
                f"{layer}: {rdr.numShapes} shapes but {rdr.numRecords} records",
            )
        out: list[RawFeature] = []
        for i, sr in enumerate(rdr.iterShapeRecords()):
            attrs = {
                n: ("" if v is None else str(v).strip())
                for n, v in zip(names, sr.record, strict=True)
            }
            out.append(RawFeature(i, attrs, _parts(sr.shape)))
    return out


# --- Transport Canada Grade Crossings Inventory -------------------------------------------

TC_REQUIRED_COLUMNS: tuple[str, ...] = (
    "TC Number",
    "Province",
    "Mile",
    "Subdivision",
    "Spur Mile Point",
    "Spur Name",
    "Railway Company",
    "Latitude",
    "Longitude",
)
"""The nine inventory columns this pipeline reads (Latitude/Longitude only for a sanity check)."""


@dataclass(frozen=True)
class TcCrossing:
    """One Transport Canada inventory row.

    Attributes:
        tc_number: Stripped ``TC Number``.
        province: Upper-case ``Province`` code.
        mile: ``Mile`` in miles along the subdivision, ``None`` when unusable (see
            :func:`~cantre_pipeline.schema_nrwn.parse_mileage`).
        subdivision: ``Subdivision`` as published (use ``norm_subdivision`` to compare).
        spur_mile_point: ``Spur Mile Point`` as published (``"-"`` for a main-line crossing).
        spur_name: ``Spur Name`` as published.
        railway: ``Railway Company``, stripped.
    """

    tc_number: str
    province: str
    mile: float | None
    subdivision: str
    spur_mile_point: str
    spur_name: str
    railway: str


@dataclass(frozen=True)
class TcInventory:
    """Rows of one province plus the TC numbers that occur more than once.

    ``rows`` leaves out every repeated number (Decision 7: such a row is used for neither
    record); ``duplicates`` maps each repeated number to how many rows carried it.
    """

    rows: dict[str, TcCrossing]
    duplicates: dict[str, int]


def read_tc_inventory_full(path: Path, province: str) -> TcInventory:
    """Read the TC inventory CSV for ``province`` (case-insensitive), with duplicates listed.

    The file is read as ``utf-8-sig`` (the published file starts with a BOM). Header names are
    stripped before matching. Rows whose ``TC Number`` is blank are skipped; rows of other
    provinces are ignored.

    Raises:
        PipelineError: ``SCHEMA_DRIFT`` when the file is empty or lacks a required column.
    """
    seen: dict[str, list[TcCrossing]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        header = [h.strip() for h in (reader.fieldnames or [])]
        missing = [c for c in TC_REQUIRED_COLUMNS if c not in header]
        if not header or missing:
            raise PipelineError(
                "SCHEMA_DRIFT", f"{path.name}: missing required columns {missing or 'all'}"
            )
        reader.fieldnames = header
        for row in reader:
            number = (row["TC Number"] or "").strip()
            prov = (row["Province"] or "").strip().upper()
            if not number or prov != province.upper():
                continue
            seen.setdefault(number, []).append(
                TcCrossing(
                    tc_number=number,
                    province=prov,
                    mile=parse_mileage(row["Mile"] or ""),
                    subdivision=(row["Subdivision"] or "").strip(),
                    spur_mile_point=(row["Spur Mile Point"] or "").strip(),
                    spur_name=(row["Spur Name"] or "").strip(),
                    railway=(row["Railway Company"] or "").strip(),
                )
            )
    rows = {k: v[0] for k, v in seen.items() if len(v) == 1}
    dups = {k: len(v) for k, v in seen.items() if len(v) > 1}
    return TcInventory(rows, dups)


def read_tc_inventory(path: Path, province: str) -> dict[str, TcCrossing]:
    """Return the province's TC rows keyed by ``TC Number``, repeated numbers excluded.

    See :func:`read_tc_inventory_full` for the duplicate list and the failure modes.
    """
    return read_tc_inventory_full(path, province).rows


def tc_duplicate_audit(inv: TcInventory) -> list[AuditRecord]:
    """One ``TC_DUPLICATE_NUMBER`` info line per repeated TC number (layer ``"TC"``)."""
    return [
        AuditRecord("TC", n, "TC_DUPLICATE_NUMBER", "info", f"{c} inventory rows share this number")
        for n, c in sorted(inv.duplicates.items())
    ]
