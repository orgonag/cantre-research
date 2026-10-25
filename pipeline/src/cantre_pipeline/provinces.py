"""Source registry: where each pipeline input comes from.

The registry holds only locations and publisher metadata. Hashes, sizes and retrieval times live
in the committed ``pipeline/sources/<id>.json`` files written by :mod:`cantre_pipeline.acquire`.
"""

from dataclasses import dataclass
from typing import Literal

from cantre_pipeline.errors import PipelineError

NRWN_BASE = "https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn"
"""NRCan FTP directory holding one ``<pr>/nrwn_rfn_<pr>_shp_en.zip`` package per province."""

OGL_NAME = "Open Government Licence - Canada"
OGL_URL = "https://open.canada.ca/en/open-government-licence-canada"

_PACKAGE_CODES = ("ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt")
"""All 13 province and territory codes, lower case; each is in ``PROVINCES`` or ``NO_PACKAGE``."""

NO_PACKAGE: frozenset[str] = frozenset({"nu", "pe"})
"""Codes for which NRCan publishes no NRWN SHP package, each with its HTTP evidence.

Evidence (2026-10-25, ``ftp.maps.canada.ca``; the server's directory listing never answered, so
only the conventional package URL was tested):

* ``nu``: ``HEAD <NRWN_BASE>/nu/nrwn_rfn_nu_shp_en.zip`` returned ``HTTP/1.1 404 Not Found``
  (Date: Sun, 25 Oct 2026 06:52:29 GMT); ``acquire --source nu --record`` got the same 404 in
  three separate runs.
* ``pe``: the same request for ``pe`` returned ``HTTP/1.1 404 Not Found``
  (Date: Sun, 25 Oct 2026 06:54:18 GMT); three ``acquire`` runs got the same 404.

The 11 other codes returned a package (``sources/<pr>.json``). A 404 is not proof that the
network has no track there; if NRCan later adds a package, move the code into the registry and
run ``acquire --record`` for it.
"""

PROVINCES: dict[str, str] = {
    code: f"{NRWN_BASE}/{code}/nrwn_rfn_{code}_shp_en.zip"
    for code in _PACKAGE_CODES
    if code not in NO_PACKAGE
}
"""NRWN SHP package URL by lower-case province code, one per code not in ``NO_PACKAGE``."""


@dataclass(frozen=True)
class SourceSpec:
    """Static description of one downloadable source.

    Attributes:
        sourceId: Short id used for the CLI and the ``sources/<id>.json`` file name.
        kind: ``"zip"`` (extracted) or ``"file"`` (hashed and copied as-is).
        url: Download URL.
        publisher: Publishing organisation.
        catalogueUrl: Open Government catalogue page for the dataset.
    """

    sourceId: str  # noqa: N815 - names match the committed JSON keys
    kind: Literal["zip", "file"]
    url: str
    publisher: str
    catalogueUrl: str  # noqa: N815


NRWN_CATALOGUE = "https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8"

TC_GCI = SourceSpec(
    sourceId="tc-gci",
    kind="file",
    url=(
        "https://open.canada.ca/data/dataset/d0f54727-6c0b-4e5a-aa04-ea1463cf9f4c/resource/"
        "a53fda5b-134f-449d-a639-9b896065fc21/download/"
        "en-grade-crossing-inventory-2023-update.csv"
    ),
    publisher="Transport Canada",
    catalogueUrl="https://open.canada.ca/data/en/dataset/d0f54727-6c0b-4e5a-aa04-ea1463cf9f4c",
)
"""Transport Canada Grade Crossings Inventory, 2023 update (OGL-Canada)."""


def source_spec(source_id: str) -> SourceSpec:
    """Return the :class:`SourceSpec` for ``source_id`` (a province code or ``"tc-gci"``).

    Raises:
        PipelineError: ``UNKNOWN_PROVINCE`` when the id is not registered.
    """
    if source_id == TC_GCI.sourceId:
        return TC_GCI
    if source_id in PROVINCES:
        return SourceSpec(
            source_id, "zip", PROVINCES[source_id], "Natural Resources Canada", NRWN_CATALOGUE
        )
    raise PipelineError("UNKNOWN_PROVINCE", f"unknown source id {source_id!r}")
