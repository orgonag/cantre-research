"""NRWN schema knowledge: required fields, shape types, CRS text, domains and value parsers.

Source: NRCan National Rail Network (NRWN) 2.0 Saskatchewan package, inspected 2026-10-24
(see ``DATA.md``). Only the fields this pipeline reads are listed, plus ``NID``; a missing one
means the publisher changed the schema, which is fatal (``SCHEMA_DRIFT``) rather than guessed at.
"""

import math
import re

LAYERS: tuple[str, ...] = (
    "TRACK",
    "CROSSING",
    "STATION",
    "MARKERPOST",
    "STRUCTURE_0",
    "STRUCTURE_1",
    "JUNCTION",
)
"""Layer names as they appear in ``NRWN_<PR>_2_0_<LAYER>.shp``."""

# Fields shared by every record that carries a mileage and a pointer to its track and subdivision.
_ANCHOR_FIELDS = frozenset(
    {
        "TRACKNID",  # NID of the track segment the feature belongs to
        "TRACKCLASS",  # Main / Siding / Yard / Spur ...
        "SUBDI1NID",  # first subdivision's NID
        "SUBDI1NAME",  # first subdivision's name
        "SUBDI2NID",  # second subdivision's NID ("None" when absent); ignored in v1, counted
        "SUBD1DIST",  # posted distance along subdivision 1 (miles; -1 = none)
        "SUB1UNITDI",  # unit of that distance ("Mile")
        "SUB1DISTY",  # distance qualifier: Posted / Unknown
    }
)

REQUIRED_FIELDS: dict[str, frozenset[str]] = {
    "TRACK": frozenset(
        {
            "NID",
            "TRACKSEGID",
            "TRACKNAME",
            "TRACKCLASS",
            "USETYPE",
            "STATUS",
            "OPERATOENA",
            "OPERATORMK",
            "OWNERENA",
            "SUBDI1NID",
            "SUBDI1NAME",
            "SUBDI2NID",
            "GEOACCURA",
        }
    ),
    "CROSSING": frozenset({"NID", "CROSSINGID", "TCID"}) | _ANCHOR_FIELDS,
    "STATION": frozenset({"NID", "STNENNAME"}) | _ANCHOR_FIELDS,
    "MARKERPOST": frozenset({"NID"}) | _ANCHOR_FIELDS,
    "STRUCTURE_0": frozenset({"NID", "STRUCID", "STRUCTYPE"}) | _ANCHOR_FIELDS,
    "STRUCTURE_1": frozenset({"NID", "STRUCID", "STRUCTYPE"}) | _ANCHOR_FIELDS,
    "JUNCTION": frozenset({"NID", "TRAJUNCTYP"}),
}
"""Fields each layer must have (DBF names, 10 characters at most)."""

EXPECTED_SHAPE_TYPES: dict[str, frozenset[int]] = {
    "TRACK": frozenset({3, 13}),  # PolyLine, PolyLineZ (SK TRACK is 13)
    "STRUCTURE_1": frozenset({3, 13}),
    "CROSSING": frozenset({1, 11}),  # Point, PointZ
    "STATION": frozenset({1, 11}),
    "MARKERPOST": frozenset({1, 11}),
    "STRUCTURE_0": frozenset({1, 11}),
    "JUNCTION": frozenset({1, 11}),
}
"""ESRI shapefile type codes accepted per layer. Z values are read and ignored."""

EXPECTED_PRJ = (
    'GEOGCS["GCS_North_American_1983_CSRS98",DATUM["D_North_American_1983_CSRS98",'
    'SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],'
    'UNIT["Degree",0.0174532925199432955]]'
)
"""The ``.prj`` of the real SK package: NAD83(CSRS98) geographic, degrees, on GRS80."""

DOMAINS: dict[str, frozenset[str]] = {
    "TRACKCLASS": frozenset(
        {"Main", "Siding", "Yard", "Spur", "Connecting", "Wye", "Crossover", "Unknown"}
    ),
    "STATUS": frozenset({"Operational", "Discontinued", "Unknown"}),
    "STRUCTYPE": frozenset({"Bridge", "Tunnel", "Culvert", "Unknown"}),
    "TRAJUNCTYP": frozenset({"Switch", "End", "Administrative", "Diamond", "Unknown"}),
}
"""Domain values seen in SK 2.0 (plus ``Unknown``, NRWN's own code for a missing value).

A value outside the set is passed through and audited ``UNKNOWN_DOMAIN_VALUE`` (info); it is a
prompt to extend this table, not a reason to drop the record. SK has two junctions with a blank
``TRAJUNCTYP``, which is audited the same way.
"""


def normalise_wkt(text: str) -> str:
    """Return ``text`` with all whitespace removed, for comparing ``.prj`` contents."""
    return "".join(text.split())


def parse_mileage(value: str) -> float | None:
    """Parse an NRWN/TC mileage string to miles, or ``None`` when it carries no usable value.

    Rule: ``float(value)`` when that is finite and ``>= 0``. Units are miles as published
    (never converted here). ``None`` for ``""``, ``"None"``, the ``-1`` sentinel (``"-1"`` or
    ``"-1.00"``), any negative value, ``nan``/``inf`` and anything non-numeric. Zero is valid
    mileage (the start of a subdivision), so ``"0.00"`` gives ``0.0``.

    Source: NRWN encodes "no value" as ``-1`` in numeric fields (spec section 3).
    """
    try:
        v = float(value.strip())
    except ValueError:
        return None
    if not math.isfinite(v) or v < 0:
        return None
    return v + 0.0  # turns -0.0 into 0.0


_OPERATOR_SUFFIX = re.compile(r"\s+-\s+\S+\s*$")


def norm_subdivision(name: str) -> str:
    """Normalise a subdivision name for matching NRWN against Transport Canada (Decision 7).

    Rule: drop one trailing ``" - <word>"`` operator suffix (``"Kingston - CN"``), case-fold, and
    keep only the letters a-z (so spaces, hyphens, apostrophes and accents are ignored; accented
    letters are dropped, not folded). ``"Indian Head"`` gives ``"indianhead"``. Limit: two names
    that differ only in punctuation or digits compare equal.
    """
    stem = _OPERATOR_SUFFIX.sub("", name.strip())
    return re.sub(r"[^a-z]", "", stem.casefold())
