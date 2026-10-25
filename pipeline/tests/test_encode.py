"""Tests for cantre_pipeline.encode: integer microdegrees, deltas, canonical JSON, gzip size."""

import gzip
import os
import subprocess
import sys
from pathlib import Path

import pytest

from cantre_pipeline.encode import (
    canonical_json,
    delta_decode,
    delta_encode,
    gzip_bytes,
    gzip_size,
    to_e6,
)


def test_delta_round_trip_and_precision() -> None:
    xs = [to_e6(v) for v in [52.1234567, 52.1234571, 51.0]]
    assert delta_decode(delta_encode(xs)) == xs
    assert abs(xs[0] / 1e6 - 52.1234567) <= 5e-7


def test_delta_encode_first_value_absolute_rest_differences() -> None:
    assert delta_encode([10, 13, 12]) == [10, 3, -1]
    assert delta_encode([]) == []
    assert delta_decode([]) == []


def test_to_e6_rounds_negative_values_to_nearest() -> None:
    assert to_e6(-106.0000004) == -106_000_000
    assert to_e6(-106.0000006) == -106_000_001
    assert to_e6(52.5, scale=1000) == 52500


def test_canonical_json_shape() -> None:
    data = canonical_json({"b": 1, "a": [1.5, "é"]})
    assert data == '{"a":[1.5,"é"],"b":1}\n'.encode()


def test_canonical_json_rejects_nan() -> None:
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})


def test_gzip_size_is_the_size_of_gzip_bytes() -> None:
    data = b"abc" * 1000
    assert gzip_size(data) == len(gzip_bytes(data))


def test_gzip_header_is_pinned_and_round_trips() -> None:
    """All ten header bytes are fixed: no mtime, no name, OS = 255, on every platform."""
    for data in (b"", b"abc" * 1000, bytes(range(256)) * 50):
        gz = gzip_bytes(data)
        # ID1 ID2, CM = deflate, FLG = 0, MTIME = 0 (4 bytes), XFL = 2 (level 9), OS = 0xff.
        assert gz[:10] == bytes([0x1F, 0x8B, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0xFF])
        assert gzip.decompress(gz) == data
        assert gzip_bytes(data) == gz


def test_canonical_json_is_stable_across_hash_seeds() -> None:
    code = (
        "import sys;from cantre_pipeline.encode import canonical_json;"
        "sys.stdout.buffer.write(canonical_json({'k'+str(i): {'z', 'y', 'x'}.__len__() "
        "for i in range(50)} | {'s': sorted({'q','w','e','r'})}))"
    )
    src = str(Path(__file__).resolve().parents[1] / "src")
    outs = []
    for seed in ("1", "2"):
        env = {**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": src}
        outs.append(
            subprocess.run(  # noqa: S603 - fixed argv, our own interpreter
                [sys.executable, "-c", code], env=env, capture_output=True, check=True
            ).stdout
        )
    assert outs[0] == outs[1] and outs[0]
