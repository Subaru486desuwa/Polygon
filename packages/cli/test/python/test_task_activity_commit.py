"""Unit tests for task.py `activity-commit` (git post-commit hook entry).

Contract under test: the command NEVER disrupts a commit — rc is always 0,
silent no-op on missing task / bookkeeping commit / git failure.

Run: python3 -m unittest discover -s test/python -v  (from packages/cli)
"""

from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

# Make `task` importable when run from anywhere.
sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[2] / "src" / "templates" / "polygon" / "scripts"),
)

import task  # noqa: E402


def _args(model=None):
    return types.SimpleNamespace(model=model)


class ActivityCommitTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.task_dir = Path(self._tmp.name)
        # get_current_task returns a path joined onto repo_root; an absolute
        # path wins the join, so the temp dir stands in for the active task.
        self._p_current = mock.patch.object(
            task, "get_current_task", return_value=str(self.task_dir)
        )
        self._p_current.start()

    def tearDown(self) -> None:
        self._p_current.stop()
        self._tmp.cleanup()

    def _activity_lines(self):
        path = self.task_dir / "activity.jsonl"
        if not path.exists():
            return []
        return [json.loads(l) for l in path.read_text().strip().splitlines()]

    def test_real_commit_is_stamped(self) -> None:
        with mock.patch.object(
            task, "run_git",
            return_value=(0, "abc1234\x1ffix(api): real work\n", ""),
        ):
            rc = task.cmd_activity_commit(_args())
        self.assertEqual(rc, 0)
        records = self._activity_lines()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["action"], "commit")
        self.assertEqual(records[0]["note"], "abc1234 fix(api): real work")

    def test_bookkeeping_commit_is_skipped(self) -> None:
        for subject in (
            "chore(task): archive 06-10-foo",
            "chore: record journal",
        ):
            with mock.patch.object(
                task, "run_git",
                return_value=(0, f"def5678\x1f{subject}\n", ""),
            ):
                rc = task.cmd_activity_commit(_args())
            self.assertEqual(rc, 0)
        self.assertEqual(self._activity_lines(), [])

    def test_git_failure_is_silent(self) -> None:
        with mock.patch.object(task, "run_git", return_value=(128, "", "fatal")):
            rc = task.cmd_activity_commit(_args())
        self.assertEqual(rc, 0)
        self.assertEqual(self._activity_lines(), [])

    def test_no_active_task_is_silent(self) -> None:
        with mock.patch.object(task, "get_current_task", return_value=None):
            rc = task.cmd_activity_commit(_args())
        self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
