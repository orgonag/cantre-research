"""Pipeline error type. The pipeline fails loudly rather than repairing bad input."""

from typing import Literal

PipelineErrorCode = Literal[
    "SCHEMA_DRIFT",
    "HASH_MISMATCH",
    "CRS_MISMATCH",
    "DOWNLOAD_FAILED",
    "UNKNOWN_PROVINCE",
    "UNSAFE_ARCHIVE",
    "TRUNCATED_DOWNLOAD",
    "INCOMPLETE_EXTRACTION",
]
"""Closed set of fatal error codes; callers branch on ``PipelineError.code``.

``UNSAFE_ARCHIVE``: a zip member name is absolute or contains ``..``.
``TRUNCATED_DOWNLOAD``: fewer bytes arrived than ``Content-Length`` promised, or the bytes are not
a readable zip.
``INCOMPLETE_EXTRACTION``: the files on disk differ from the archive's file list (names, sizes or
SHA-256), for example because a write failed or a Windows path was too long.
"""


class PipelineError(Exception):
    """A fatal pipeline condition identified by a machine-readable ``code``."""

    def __init__(self, code: PipelineErrorCode, message: str) -> None:
        """Create the error.

        Args:
            code: One of :data:`PipelineErrorCode`.
            message: Human-readable explanation.
        """
        super().__init__(message)
        self.code: PipelineErrorCode = code
