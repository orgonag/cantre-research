"""Number and byte encoding for tiles and the manifest (spec section 5.7, Global Constraints).

Coordinates are stored as integer microdegrees, arrays as first-absolute-then-differences, JSON as
canonical UTF-8 bytes and sizes as gzip level 9 with ``mtime=0``. Nothing here reads a clock.
"""

import gzip
import json
from collections.abc import Sequence


def to_e6(v: float, scale: int = 1_000_000) -> int:
    """Return ``round(v * scale)`` as an int: degrees to integer microdegrees by default.

    Rounding is Python's round-half-to-even on the float product; at 1e-6 deg the rounding error
    is at most 5e-7 deg (about 0.056 m north-south). The same function quantises distances with
    ``scale=1000`` (metres to integer millimetres). Source: spec section 5.7.
    """
    return round(v * scale)


def delta_encode(xs: Sequence[int]) -> list[int]:
    """Return ``[xs[0], xs[1]-xs[0], xs[2]-xs[1], ...]`` (empty in, empty out). Integers only."""
    return [x - (xs[i - 1] if i else 0) for i, x in enumerate(xs)]


def delta_decode(ds: Sequence[int]) -> list[int]:
    """Invert :func:`delta_encode` by running sum, so ``delta_decode(delta_encode(xs)) == xs``."""
    out: list[int] = []
    total = 0
    for d in ds:
        total += d
        out.append(total)
    return out


def canonical_json(obj: object) -> bytes:
    r"""Return the canonical JSON of ``obj`` as UTF-8 bytes.

    Sorted keys, ``separators=(",", ":")``, ``ensure_ascii=False`` and one trailing ``"\n"``
    (Global Constraints). NaN and infinity are refused (``ValueError``) because they are not JSON.
    """
    text = json.dumps(
        obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )
    return (text + "\n").encode("utf-8")


def gzip_size(data: bytes) -> int:
    """Return the gzip size of ``data`` in bytes, level 9, ``mtime=0`` (the tile budget metric)."""
    return len(gzip.compress(data, compresslevel=9, mtime=0))
