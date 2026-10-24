"""Pipeline error type. The pipeline fails loudly rather than repairing bad input."""

from typing import Literal

PipelineErrorCode = Literal[
    "SCHEMA_DRIFT", "HASH_MISMATCH", "CRS_MISMATCH", "DOWNLOAD_FAILED", "UNKNOWN_PROVINCE"
]
"""Closed set of fatal error codes; callers branch on ``PipelineError.code``."""


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
