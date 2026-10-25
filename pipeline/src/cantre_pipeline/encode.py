"""Number and byte encoding for tiles and the manifest (spec section 5.7, Global Constraints).

Coordinates are stored as integer microdegrees, arrays as first-absolute-then-differences, JSON as
canonical UTF-8 bytes and sizes as gzip level 9 with every header byte pinned
(:func:`gzip_bytes`). Nothing here reads a clock.
"""

import json
import struct
import zlib
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


# gzip member header (RFC 1952 section 2.3), all ten bytes fixed so the output does not depend on
# the platform or zlib build: ID1 ID2 = 1f 8b, CM = 8 (deflate), FLG = 0 (no name, extra, comment or
# header CRC), MTIME = 0 (4 bytes, no clock), XFL = 2 (slowest compression, level 9), OS = 255
# (unknown). zlib's own wrapper writes its build platform's OS code here (3 on Unix, 10 on Windows),
# which made the same input give different bytes on Linux CI and on a Windows machine.
_GZIP_HEADER = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x02\xff"


def gzip_bytes(data: bytes) -> bytes:
    """Gzip ``data`` at level 9 with a fully pinned header: same header bytes on every platform.

    Layout: the 10-byte header above, a raw deflate stream (``wbits=-15``, level 9, default
    memLevel), then CRC-32 and ISIZE (``len(data)`` mod 2**32), each 4 bytes little-endian. Only
    the header's platform byte used to differ between machines; the deflate stream is what zlib's
    level 9 gives for the input.
    """
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    body = comp.compress(data) + comp.flush()
    return _GZIP_HEADER + body + struct.pack("<II", zlib.crc32(data), len(data) & 0xFFFFFFFF)


def gzip_size(data: bytes) -> int:
    """Return the gzip size of ``data`` in bytes, level 9 (the tile budget metric)."""
    return len(gzip_bytes(data))
