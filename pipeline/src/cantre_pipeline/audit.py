"""Audit log: a closed set of reason codes and a canonical JSONL writer.

Nothing is dropped silently (spec section 5): every rejected or altered record gets one line.
``severity`` is ``"rejected"`` when the record is not used and ``"info"`` when it is kept (or the
note is only informational). Exactly one ``"rejected"`` line is written per rejected record, so
kept + rejected equals the input count per layer.
"""

import json
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, get_args

AuditReason = Literal[
    # geometry
    "NULL_GEOMETRY",
    "MULTIPART_GEOMETRY",
    "COORD_OUT_OF_RANGE",
    "DEGENERATE_SEGMENT",
    "VERTEX_DEDUPED",
    # identity
    "DUPLICATE_NID",
    "DUPLICATE_SEGID",
    "UNKNOWN_DOMAIN_VALUE",
    # anchors
    "NOT_POSTED",
    "UNIT_NOT_MILE",
    "MILEAGE_SENTINEL",
    "POSTED_SENTINEL",
    "TRACK_NOT_FOUND",
    "TRACK_NOT_CHAINED",
    "SUBDIVISION_MISMATCH",
    "RESIDUAL_TOO_LARGE",
    "AMBIGUOUS_TRACK",
    "ANCHOR_CONFLICT",
    "ANCHOR_MERGED",
    "ANCHOR_COLLAPSED",
    "ANCHOR_OUTLIER",
    "SOURCE_DISAGREEMENT",
    "UNVERIFIED_DEVIATION",
    # Transport Canada join
    "TC_NO_ROW",
    "TC_SPUR_CROSSING",
    "TC_SUBDIVISION_MISMATCH",
    "TC_BAD_MILE",
    "TC_DUPLICATE_NUMBER",
    # topology
    "JUNCTION_OFF_NETWORK",
    "CHAIN_CYCLE",
    # scope
    "NOT_CHAINED_CLASS",
    "NOT_OPERATIONAL",
    "SECOND_SUBDIVISION_IGNORED",
    # assets
    "ASSET_UNPOSITIONED",
]
"""The closed set of audit reason codes (34); ``ASSET_UNPOSITIONED`` (info) marks an asset that ends
with no chain position, the cause being in the detail."""

AUDIT_REASONS: frozenset[str] = frozenset(get_args(AuditReason))

Severity = Literal["rejected", "info"]


@dataclass(frozen=True)
class AuditRecord:
    """One audit line.

    Attributes:
        layer: Source layer (``"TRACK"``...) or ``"TC"`` for the Transport Canada inventory.
        nid: The record's ``NID`` (TC number for ``"TC"``); ``"#<index>"`` when it has none.
        reason: One of :data:`AuditReason`.
        severity: ``"rejected"`` (record not used) or ``"info"`` (kept or informational).
        detail: Human-readable specifics (counts, offending value); deterministic text only.
    """

    layer: str
    nid: str
    reason: AuditReason
    severity: Severity
    detail: str


def write_audit_jsonl(path: Path, records: Iterable[AuditRecord]) -> None:
    """Write ``records`` to ``path`` as canonical JSON Lines.

    Lines are sorted by ``(layer, nid, reason, detail)`` so the file does not depend on input
    order. Each line is JSON with sorted keys, ``separators=(",", ":")`` and
    ``ensure_ascii=False``, UTF-8, LF line endings. An empty input writes an empty file.
    Parent directories are created. Source: spec section 5 (determinism).
    """
    ordered = sorted(records, key=lambda r: (r.layer, r.nid, r.reason, r.detail))
    lines = [
        json.dumps(asdict(r), sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
        for r in ordered
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.writelines(lines)
