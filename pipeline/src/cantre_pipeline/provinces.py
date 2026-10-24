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

PROVINCES: dict[str, str] = {
    "sk": f"{NRWN_BASE}/sk/nrwn_rfn_sk_shp_en.zip",
}
"""NRWN SHP package URL by lower-case province code. M5 adds the other provinces."""


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
