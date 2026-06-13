"""Unit tests for common.workflow_phase.get_phase_index boundary.

Regression for the rebrand bug: the end-anchor literal
'## Customizing Polygon (for forks)' no longer matched the renamed
'## Customizing' heading, so get_phase_index() over-captured to EOF and
swallowed the Ultracode + Customizing footer.

Stdlib unittest only (template scripts ship no test framework).
Run: python3 -m unittest discover -s test/python -v  (from packages/cli)
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

# Make `common` importable (mirrors test_activity.py).
sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[2] / "src" / "templates" / "polygon" / "scripts"),
)

from common import workflow_phase  # noqa: E402

# Mirrors the real workflow.md heading order: the footer heading is the bare
# '## Customizing' (post-rebrand), with the Ultracode section sitting between
# Phase 3 and the footer.
_SAMPLE = """# Development Workflow

## Core Principles
principles body

## Phase Index
phase index overview
[workflow-state:no_task]
breadcrumb text
[/workflow-state:no_task]

## Phase 1: Plan
plan body

## Phase 3: Finish
finish body

## Polygon × Ultracode
ULTRA_MARKER fan-out template

## Customizing
CUSTOMIZING_MARKER edit this file directly
"""


class GetPhaseIndexBoundaryTests(unittest.TestCase):
    def _run(self) -> str:
        with mock.patch.object(workflow_phase, "_read_workflow", return_value=_SAMPLE):
            return workflow_phase.get_phase_index()

    def test_includes_phase_index_and_phase_bodies(self) -> None:
        out = self._run()
        self.assertIn("## Phase Index", out)
        self.assertIn("## Phase 1: Plan", out)
        self.assertIn("## Phase 3: Finish", out)

    def test_stops_before_customizing_section(self) -> None:
        # The rebrand bug let output run to EOF and swallow the footer.
        out = self._run()
        self.assertNotIn("## Customizing", out)
        self.assertNotIn("CUSTOMIZING_MARKER", out)

    def test_strips_workflow_state_blocks(self) -> None:
        out = self._run()
        self.assertNotIn("[workflow-state", out)
        self.assertNotIn("breadcrumb text", out)


if __name__ == "__main__":
    unittest.main()
