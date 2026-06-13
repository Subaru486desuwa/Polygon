"""
JSON file I/O utilities.

Provides read_json and write_json as the single source of truth
for JSON file operations across all Polygon scripts.

write_json is atomic (temp file + os.replace) so an interrupted or concurrent
write can never leave a truncated/corrupt JSON file on disk.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def read_json(path: Path) -> dict | None:
    """Read and parse a JSON file.

    Returns None if the file is missing or unreadable. If the file exists but
    holds invalid JSON (e.g. truncated by an interrupted write), emit a stderr
    warning before returning None so the corruption is visible rather than
    silently treated as 'no data'.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        print(
            f"[polygon] warning: corrupt JSON at {path} ({exc}); treating as missing",
            file=sys.stderr,
        )
        return None


def write_json(path: Path, data: dict) -> bool:
    """Write dict to JSON file atomically.

    Serializes to a sibling temp file, fsyncs it, then os.replace()s it over
    the target. The rename is atomic on the same filesystem, so a crash or a
    concurrent writer can never observe a half-written file. Returns True on
    success, False on error (serialization or I/O).
    """
    try:
        payload = json.dumps(data, indent=2, ensure_ascii=False)
    except (TypeError, ValueError):
        return False

    tmp_path: str | None = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
        )
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        # mkstemp creates 0600; match the 0644 that write_text produced before.
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, path)
        return True
    except (OSError, IOError):
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        return False
