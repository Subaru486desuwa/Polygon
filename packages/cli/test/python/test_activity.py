"""Unit tests for common.activity (multi-LLM task activity log).

Stdlib unittest only (no pytest dependency — template scripts ship no test
framework). `resolve_context_key` is patched so platform/session resolution is
deterministic regardless of the ambient CI/agent environment.

Run: python3 -m unittest discover -s test/python -v  (from packages/cli)
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Make `common` importable when run from anywhere.
sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[2] / "src" / "templates" / "polygon" / "scripts"),
)

from common.activity import (  # noqa: E402
    ACTIVITY_FILENAME,
    append_activity,
    read_activity,
    resolve_actor,
    upsert_task_agent,
)

_CTX = "common.activity.resolve_context_key"


class ActivityFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.task = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    @mock.patch(_CTX, return_value="claude_2b56e91f-deadbeef")
    def test_append_creates_file_and_record(self, _ctx) -> None:
        rec = append_activity(self.task, "start", "kick off")
        self.assertIsNotNone(rec)
        self.assertEqual(rec["platform"], "claude")
        self.assertEqual(rec["action"], "start")
        self.assertEqual(rec["session"], "2b56e91f")
        self.assertTrue((self.task / ACTIVITY_FILENAME).is_file())
        recs = read_activity(self.task)
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["note"], "kick off")

    @mock.patch(_CTX, return_value=None)
    def test_append_only_preserves_order(self, _ctx) -> None:
        append_activity(self.task, "start", "a", platform="claude")
        append_activity(self.task, "check", "b", platform="codex")
        recs = read_activity(self.task)
        self.assertEqual([r["platform"] for r in recs], ["claude", "codex"])
        self.assertEqual([r["action"] for r in recs], ["start", "check"])

    def test_read_missing_returns_empty(self) -> None:
        self.assertEqual(read_activity(self.task), [])

    def test_read_skips_malformed_lines(self) -> None:
        path = self.task / ACTIVITY_FILENAME
        path.write_text('{"ok": 1}\nnot json\n\n{"ok": 2}\n', encoding="utf-8")
        recs = read_activity(self.task)
        self.assertEqual(len(recs), 2)
        self.assertEqual([r["ok"] for r in recs], [1, 2])

    @mock.patch(_CTX, return_value="claude_x")
    def test_unicode_note_roundtrip(self, _ctx) -> None:
        append_activity(self.task, "decision", "已拍板：per-task activity.jsonl")
        line = (self.task / ACTIVITY_FILENAME).read_text(encoding="utf-8")
        self.assertIn("已拍板", line)  # not \uXXXX-escaped
        self.assertIn("已拍板", read_activity(self.task)[0]["note"])

    @mock.patch(_CTX, return_value="claude_x")
    def test_explicit_ts_preserved(self, _ctx) -> None:
        rec = append_activity(self.task, "finish", ts="2026-01-01T00:00:00Z")
        self.assertEqual(rec["ts"], "2026-01-01T00:00:00Z")

    @mock.patch(_CTX, return_value="claude_2b56e91f-x")
    def test_append_rolls_up_into_task_json(self, _ctx) -> None:
        (self.task / "task.json").write_text('{"meta": {}}', encoding="utf-8")
        append_activity(self.task, "start", "go")
        data = json.loads((self.task / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(data["meta"]["agents"][0]["platform"], "claude")

    @mock.patch(_CTX, return_value="claude_aaa")
    def test_append_proxy_codex_drops_foreign_session(self, _ctx) -> None:
        # Claude stamping on Codex's behalf: record codex, but never tag it
        # with the ambient claude session id.
        rec = append_activity(self.task, "implement", "via codex:rescue", platform="codex")
        self.assertEqual(rec["platform"], "codex")
        self.assertIsNone(rec["session"])


class ResolveActorTests(unittest.TestCase):
    def setUp(self) -> None:
        # Isolate env vars resolve_actor consults.
        self._saved = {
            k: os.environ.pop(k)
            for k in ("AI_AGENT", "POLYGON_ACTIVITY_MODEL")
            if k in os.environ
        }

    def tearDown(self) -> None:
        for k in ("AI_AGENT", "POLYGON_ACTIVITY_MODEL"):
            os.environ.pop(k, None)
        os.environ.update(self._saved)

    @mock.patch(_CTX, return_value="codex_abcdef123456")
    def test_platform_and_session_from_context_id(self, _ctx) -> None:
        plat, session, model = resolve_actor()
        self.assertEqual(plat, "codex")
        self.assertEqual(session, "abcdef12")
        self.assertIsNone(model)

    @mock.patch(_CTX, return_value="claude_zzz")
    def test_explicit_platform_drops_foreign_session(self, _ctx) -> None:
        # Claude session stamping as codex → platform=codex, but the claude
        # session id must NOT be attributed to codex.
        plat, session, _model = resolve_actor(platform="codex")
        self.assertEqual(plat, "codex")
        self.assertIsNone(session)

    @mock.patch(_CTX, return_value="codex_abcdef123456")
    def test_same_platform_keeps_session(self, _ctx) -> None:
        plat, session, _model = resolve_actor(platform="codex")
        self.assertEqual(plat, "codex")
        self.assertEqual(session, "abcdef12")

    @mock.patch(_CTX, return_value="claude_zzz")
    def test_explicit_session_overrides(self, _ctx) -> None:
        _plat, session, _model = resolve_actor(platform="codex", session="codexsess")
        self.assertEqual(session, "codexsess")

    @mock.patch(_CTX, return_value=None)
    def test_ai_agent_env_fallback(self, _ctx) -> None:
        os.environ["AI_AGENT"] = "claude-code_2-1-169_agent"
        plat, _session, _model = resolve_actor()
        self.assertEqual(plat, "claude")

    @mock.patch(_CTX, return_value=None)
    def test_unknown_platform_when_no_signal(self, _ctx) -> None:
        plat, session, model = resolve_actor()
        self.assertEqual(plat, "unknown")
        self.assertIsNone(session)
        self.assertIsNone(model)

    @mock.patch(_CTX, return_value="claude_x")
    def test_model_from_env(self, _ctx) -> None:
        os.environ["POLYGON_ACTIVITY_MODEL"] = "opus-4.8"
        _plat, _session, model = resolve_actor(platform="claude")
        self.assertEqual(model, "opus-4.8")

    @mock.patch(_CTX, return_value="claude_x")
    def test_explicit_model_beats_env(self, _ctx) -> None:
        os.environ["POLYGON_ACTIVITY_MODEL"] = "haiku"
        _plat, _session, model = resolve_actor(model="opus-4.8")
        self.assertEqual(model, "opus-4.8")


class UpsertTaskAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.task = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write_task_json(self, meta) -> None:
        data = {"id": "t", "status": "in_progress"}
        if meta is not None:
            data["meta"] = meta
        (self.task / "task.json").write_text(json.dumps(data), encoding="utf-8")

    def _agents(self) -> list:
        data = json.loads((self.task / "task.json").read_text(encoding="utf-8"))
        return data["meta"]["agents"]

    def test_no_task_json_returns_false(self) -> None:
        self.assertFalse(upsert_task_agent(self.task, "claude", "opus", "T"))

    def test_appends_new_agent(self) -> None:
        self._write_task_json(meta={})
        self.assertTrue(upsert_task_agent(self.task, "claude", "opus-4.8", "T1"))
        agents = self._agents()
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["platform"], "claude")
        self.assertEqual(agents[0]["first_seen"], "T1")

    def test_same_platform_updates_not_duplicates(self) -> None:
        self._write_task_json(meta={})
        upsert_task_agent(self.task, "claude", "opus", "T1")
        upsert_task_agent(self.task, "claude", "opus-4.8", "T2")
        agents = self._agents()
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["first_seen"], "T1")
        self.assertEqual(agents[0]["last_seen"], "T2")
        self.assertEqual(agents[0]["model"], "opus-4.8")

    def test_different_platforms_coexist(self) -> None:
        self._write_task_json(meta={})
        upsert_task_agent(self.task, "claude", "opus", "T1")
        upsert_task_agent(self.task, "codex", "gpt", "T2")
        self.assertEqual({a["platform"] for a in self._agents()}, {"claude", "codex"})

    def test_missing_meta_key_created(self) -> None:
        self._write_task_json(meta=None)
        self.assertTrue(upsert_task_agent(self.task, "claude", None, "T"))
        self.assertIn("agents", json.loads(
            (self.task / "task.json").read_text(encoding="utf-8"))["meta"])


if __name__ == "__main__":
    unittest.main()
