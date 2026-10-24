"""Synthetic NRWN shapefile + Transport Canada CSV writer for tests (pyshp).

``NrwnFixture`` writes a tiny package that has the same layers, field names, shape types and
``.prj`` as the real NRWN SK 2.0 package, so the reader and every later stage can be tested
without any NRWN data. All values are invented; nothing is copied from NRWN.

Coordinate order: every geometry argument here is ``LatLon`` order ``(lat, lon)`` like the
pipeline's own model; the writer swaps to the shapefile's (x = lon, y = lat). A ``None`` geometry
writes a NULL shape. Attribute defaults follow the real files: text sentinel ``"None"``,
numeric sentinel ``-1`` and a mileage of ``-1`` when ``mp`` is ``None``.
"""

from __future__ import annotations

import csv
from collections.abc import Sequence
from pathlib import Path

import shapefile  # type: ignore[import-untyped,unused-ignore]

from cantre_pipeline.geodesy import LatLon

# Copied from the real NRWN_SK_2_0_TRACK.prj (one line, GEOGCS NAD83(CSRS98)). Deliberately not
# imported from production code so a typo there cannot hide behind the same typo here.
NRWN_PRJ = (
    'GEOGCS["GCS_North_American_1983_CSRS98",DATUM["D_North_American_1983_CSRS98",'
    'SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],'
    'UNIT["Degree",0.0174532925199432955]]'
)
WGS84_PRJ = (
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199432955]]'
)

# (name, type, size, decimals) in file order, per layer. Mirrors real NRWN field types.
_C = "C"
_N = "N"
_SUB = [
    ("TRACKNID", _C, 32, 0),
    ("TRACKCLASS", _C, 20, 0),
    ("SUBDI1NID", _C, 32, 0),
    ("SUBDI1NAME", _C, 100, 0),
    ("SUBD1DIST", _N, 8, 2),
    ("SUB1UNITDI", _C, 20, 0),
    ("SUB1DISTY", _C, 15, 0),
]
LAYER_FIELDS: dict[str, list[tuple[str, str, int, int]]] = {
    "TRACK": [
        ("NID", _C, 32, 0),
        ("TRACKSEGID", _C, 32, 0),
        ("TRACKNAME", _C, 100, 0),
        ("TRACKCLASS", _C, 20, 0),
        ("USETYPE", _C, 30, 0),
        ("STATUS", _C, 20, 0),
        ("OPERATOENA", _C, 100, 0),
        ("OPERATORMK", _C, 10, 0),
        ("OWNERENA", _C, 100, 0),
        ("SUBDI1NID", _C, 32, 0),
        ("SUBDI1NAME", _C, 100, 0),
        ("GEOACCURA", _N, 3, 0),
    ],
    "CROSSING": [("NID", _C, 32, 0), ("CROSSINGID", _C, 32, 0), ("TCID", _N, 9, 0), *_SUB],
    "STATION": [("NID", _C, 32, 0), ("STNENNAME", _C, 100, 0), *_SUB],
    "MARKERPOST": [("NID", _C, 32, 0), *_SUB],
    "STRUCTURE_0": [("NID", _C, 32, 0), ("STRUCID", _C, 32, 0), ("STRUCTYPE", _C, 15, 0), *_SUB],
    "STRUCTURE_1": [("NID", _C, 32, 0), ("STRUCID", _C, 32, 0), ("STRUCTYPE", _C, 15, 0), *_SUB],
    "JUNCTION": [("NID", _C, 32, 0), ("TRAJUNCTYP", _C, 15, 0)],
}
_SHAPE_TYPES = {
    "TRACK": shapefile.POLYLINEZ,
    "STRUCTURE_1": shapefile.POLYLINE,
    "CROSSING": shapefile.POINT,
    "STATION": shapefile.POINT,
    "MARKERPOST": shapefile.POINT,
    "STRUCTURE_0": shapefile.POINT,
    "JUNCTION": shapefile.POINT,
}
TC_COLUMNS = [
    "TC Number",
    "Railway Company",
    "Province",
    "Mile",
    "Subdivision",
    "Spur Mile Point",
    "Spur Name",
    "Latitude",
    "Longitude",
]

Sub = tuple[str, str]
Parts = list[list[LatLon]]


class _Row:
    """One queued feature: geometry (parts of (lat, lon); ``None`` = null) plus attributes."""

    def __init__(self, parts: Parts | None, values: dict[str, object]) -> None:
        self.parts = parts
        self.values = values


def _default(kind: str) -> object:
    """NRWN-like default for a field: numeric ``-1``, text ``"None"``."""
    return -1 if kind == _N else "None"


class NrwnFixture:
    """Collects features and TC rows, then writes them to ``tmp_path`` with ``write()``.

    Attributes:
        prj_text: Text written to every ``.prj``; set to ``WGS84_PRJ`` to test CRS rejection.
        drop_fields: ``(layer, field)`` pairs left out of the DBF, to test schema drift.
        drop_tc_columns: TC CSV header names to omit.
        province: Lower-case province code used in file names (default ``"sk"``).
    """

    def __init__(self, tmp_path: Path, province: str = "sk") -> None:
        """Create an empty fixture rooted at ``tmp_path`` (nothing is written yet)."""
        self.root = tmp_path
        self.province = province
        self.prj_text = NRWN_PRJ
        self.drop_fields: set[tuple[str, str]] = set()
        self.drop_tc_columns: set[str] = set()
        self._rows: dict[str, list[_Row]] = {name: [] for name in LAYER_FIELDS}
        self._tc: list[dict[str, str]] = []

    @property
    def shp_dir(self) -> Path:
        """Directory that ``write()`` fills with the shapefile layers."""
        return self.root / "nrwn"

    @property
    def tc_path(self) -> Path:
        """Path of the Transport Canada CSV written by ``write()``."""
        return self.root / "tc.csv"

    # --- builders ---------------------------------------------------------------------------

    def _add(self, layer: str, parts: Parts | None, values: dict[str, object]) -> None:
        base = {name: _default(kind) for name, kind, _s, _d in LAYER_FIELDS[layer]}
        unknown = set(values) - set(base)
        if unknown:
            raise KeyError(f"{layer} has no fields {sorted(unknown)}")
        base.update(values)
        self._rows[layer].append(_Row(parts, base))

    @staticmethod
    def _anchor(
        track_nid: str, mp: float | None, qualifier: str, sub: Sub, track_class: str, unit: str
    ) -> dict[str, object]:
        return {
            "TRACKNID": track_nid,
            "TRACKCLASS": track_class,
            "SUBDI1NID": sub[0],
            "SUBDI1NAME": sub[1],
            "SUBD1DIST": -1.0 if mp is None else mp,
            "SUB1UNITDI": unit,
            "SUB1DISTY": qualifier,
        }

    @staticmethod
    def _line_parts(
        pts: Sequence[LatLon] | None, extra: Sequence[Sequence[LatLon]]
    ) -> Parts | None:
        return None if pts is None else [list(pts), *[list(p) for p in extra]]

    def track(
        self,
        segid: str,
        pts: Sequence[LatLon] | None,
        *,
        nid: str | None = None,
        cls: str = "Main",
        status: str = "Operational",
        sub: Sub = ("S1", "Alpha"),
        op: str = "CN",
        extra_parts: Sequence[Sequence[LatLon]] = (),
        geoaccura: int = 10,
        owner: str = "Owner",
        use_type: str = "Freight",
        track_name: str = "None",
    ) -> None:
        """Add a TRACK segment. ``pts`` is ``(lat, lon)`` vertices or ``None`` (null shape).

        ``extra_parts`` adds further parts, making the shape multipart.
        """
        self._add(
            "TRACK",
            self._line_parts(pts, extra_parts),
            {
                "NID": nid if nid is not None else segid,
                "TRACKSEGID": segid,
                "TRACKNAME": track_name,
                "TRACKCLASS": cls,
                "USETYPE": use_type,
                "STATUS": status,
                "OPERATOENA": op,
                "OPERATORMK": op,
                "OWNERENA": owner,
                "SUBDI1NID": sub[0],
                "SUBDI1NAME": sub[1],
                "GEOACCURA": geoaccura,
            },
        )

    def crossing(
        self,
        nid: str,
        pt: LatLon | None,
        track_nid: str,
        *,
        mp: float | None = None,
        qualifier: str = "Posted",
        crossing_id: str = "None",
        sub: Sub = ("S1", "Alpha"),
        tcid: int = -1,
        track_class: str = "Main",
        unit: str = "Mile",
    ) -> None:
        """Add a CROSSING point. ``mp=None`` writes the ``-1`` mileage sentinel."""
        values = self._anchor(track_nid, mp, qualifier, sub, track_class, unit)
        values.update({"NID": nid, "CROSSINGID": crossing_id, "TCID": tcid})
        self._add("CROSSING", None if pt is None else [[pt]], values)

    def station(
        self,
        nid: str,
        pt: LatLon | None,
        track_nid: str,
        *,
        mp: float | None = None,
        qualifier: str = "Unknown",
        sub: Sub = ("S1", "Alpha"),
        track_class: str = "Main",
        unit: str = "Mile",
        name: str = "Stn",
    ) -> None:
        """Add a STATION point (NRWN stations in SK are all qualifier ``Unknown``)."""
        values = self._anchor(track_nid, mp, qualifier, sub, track_class, unit)
        values.update({"NID": nid, "STNENNAME": name})
        self._add("STATION", None if pt is None else [[pt]], values)

    def markerpost(
        self,
        nid: str,
        pt: LatLon | None,
        track_nid: str,
        *,
        mp: float | None = None,
        qualifier: str = "Unknown",
        sub: Sub = ("S1", "Alpha"),
        track_class: str = "Main",
        unit: str = "Mile",
    ) -> None:
        """Add a MARKERPOST point (NRWN marker posts in SK are all qualifier ``Unknown``)."""
        values = self._anchor(track_nid, mp, qualifier, sub, track_class, unit)
        values["NID"] = nid
        self._add("MARKERPOST", None if pt is None else [[pt]], values)

    def culvert(
        self,
        nid: str,
        pt: LatLon | None,
        track_nid: str,
        *,
        mp: float | None = None,
        qualifier: str = "Unknown",
        sub: Sub = ("S1", "Alpha"),
        track_class: str = "Main",
        unit: str = "Mile",
        kind: str = "Culvert",
    ) -> None:
        """Add a STRUCTURE_0 point (culvert by default)."""
        values = self._anchor(track_nid, mp, qualifier, sub, track_class, unit)
        values.update({"NID": nid, "STRUCID": "", "STRUCTYPE": kind})
        self._add("STRUCTURE_0", None if pt is None else [[pt]], values)

    def bridge(
        self,
        nid: str,
        pts: Sequence[LatLon] | None,
        track_nid: str,
        *,
        mp: float | None = None,
        qualifier: str = "Unknown",
        sub: Sub = ("S1", "Alpha"),
        track_class: str = "Main",
        unit: str = "Mile",
        kind: str = "Bridge",
        extra_parts: Sequence[Sequence[LatLon]] = (),
    ) -> None:
        """Add a STRUCTURE_1 line (bridge by default). ``pts`` are ``(lat, lon)`` vertices."""
        values = self._anchor(track_nid, mp, qualifier, sub, track_class, unit)
        values.update({"NID": nid, "STRUCID": "None", "STRUCTYPE": kind})
        self._add("STRUCTURE_1", self._line_parts(pts, extra_parts), values)

    def junction(self, nid: str, pt: LatLon | None, kind: str) -> None:
        """Add a JUNCTION point of ``TRAJUNCTYP`` ``kind`` (Switch, End, Diamond ...)."""
        self._add("JUNCTION", None if pt is None else [[pt]], {"NID": nid, "TRAJUNCTYP": kind})

    def tc_row(
        self,
        tc_number: int | str,
        *,
        mile: float | str,
        subdivision: str,
        spur_mile_point: str = "-",
        province: str = "SK",
        railway: str = "CN",
        spur_name: str = "-",
    ) -> None:
        """Add a Transport Canada inventory row (``mile`` floats are written with 2 decimals)."""
        self._tc.append(
            {
                "TC Number": str(tc_number),
                "Railway Company": railway,
                "Province": province,
                "Mile": f"{mile:.2f}" if isinstance(mile, float) else mile,
                "Subdivision": subdivision,
                "Spur Mile Point": spur_mile_point,
                "Spur Name": spur_name,
                "Latitude": "50.0",
                "Longitude": "-105.0",
            }
        )

    # --- writer -----------------------------------------------------------------------------

    def write(self) -> Path:
        """Write every layer and the TC CSV; return the shapefile directory."""
        self.shp_dir.mkdir(parents=True, exist_ok=True)
        for layer, fields in LAYER_FIELDS.items():
            kept = [f for f in fields if (layer, f[0]) not in self.drop_fields]
            base = self.shp_dir / f"NRWN_{self.province.upper()}_2_0_{layer}"
            w = shapefile.Writer(str(base), shapeType=_SHAPE_TYPES[layer], encoding="latin-1")
            for name, kind, size, dec in kept:
                w.field(name, kind, size, dec)
            for row in self._rows[layer]:
                self._write_geometry(w, layer, row.parts)
                w.record(*[row.values[f[0]] for f in kept])
            w.close()
            base.with_suffix(".prj").write_text(self.prj_text, encoding="ascii")
        with self.tc_path.open("w", encoding="utf-8-sig", newline="") as fh:
            cols = [c for c in TC_COLUMNS if c not in self.drop_tc_columns]
            writer = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(self._tc)
        return self.shp_dir

    @staticmethod
    def _write_geometry(w: shapefile.Writer, layer: str, parts: Parts | None) -> None:
        """Write one shape; coordinates go out as (x = lon, y = lat)."""
        if parts is None:
            w.null()
        elif layer == "TRACK":
            w.linez([[(p.lon, p.lat, 0.0) for p in part] for part in parts])
        elif layer == "STRUCTURE_1":
            w.line([[(p.lon, p.lat) for p in part] for part in parts])
        else:
            w.point(parts[0][0].lon, parts[0][0].lat)
