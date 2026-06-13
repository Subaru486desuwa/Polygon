"""Unit tests for common.io: atomic write_json + corrupt-read visibility.

Covers the data-safety hardening:
  - write_json writes atomically (no temp leak, original preserved on failure)
  - write_json returns False (not crash) on unserializable input
  - read_json distinguishes 'missing' (silent) from 'corrupt' (stderr warning)

Stdlib unittest only (template scripts ship no test framework).
Run: python3 -m unittest discover -s test/python -v  (from packages/cli)
"""

from __future__ import annotations

import io as _io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

# Make `common` importable (mirrors test_activity.py).
sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[2] / "src" / "templates" / "polygon" / "scripts"),
)

from common.io import read_json, write_json  # noqa: E402


class WriteJsonAtomicTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.path = self.dir / "task.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _strays(self) -> list[str]:
        return sorted(p.name for p in self.dir.iterdir() if p.name != "task.json")

    def test_round_trip_utf8(self) -> None:
        self.assertTrue(write_json(self.path, {"a": 1, "中文": "ok"}))
        self.assertEqual(read_json(self.path), {"a": 1, "中文": "ok"})

    def test_no_temp_file_left_behind(self) -> None:
        self.assertTrue(write_json(self.path, {"k": "v"}))
        self.assertEqual(self._strays(), [], "atomic write leaked a temp file")

    def test_unserializable_returns_false_and_preserves_original(self) -> None:
        self.assertTrue(write_json(self.path, {"good": True}))
        # object() is not JSON-serializable; old code raised TypeError uncaught.
        self.assertFalse(write_json(self.path, {"bad": object()}))
        self.assertEqual(read_json(self.path), {"good": True})  # untouched
        self.assertEqual(self._strays(), [], "failed write leaked a temp file")

    def test_missing_parent_dir_returns_false(self) -> None:
        self.assertFalse(write_json(self.dir / "nope" / "x.json", {"a": 1}))


class ReadJsonCorruptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "task.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_missing_is_silent_none(self) -> None:
        buf = _io.StringIO()
        with redirect_stderr(buf):
            self.assertIsNone(read_json(self.path))
        self.assertEqual(buf.getvalue(), "", "missing file should not warn")

    def test_corrupt_returns_none_with_stderr_warning(self) -> None:
        self.path.write_text("{ truncated", encoding="utf-8")  # invalid JSON
        buf = _io.StringIO()
        with redirect_stderr(buf):
            self.assertIsNone(read_json(self.path))
        self.assertIn("corrupt JSON", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
