"""
Multi-LLM task activity log (activity.jsonl).

Append-only, per-task log of *who (platform/model) did what, when*. One JSON
object per line. The point is cross-LLM handoff: a different agent (e.g. Codex)
picking up a task can read what a prior agent (e.g. Claude) already did and
decided, without sharing a conversation.

Schema (one line each):
    {"ts": "2026-06-09T12:34:56Z", "platform": "claude|codex|...",
     "model": "<id|null>", "session": "<short-id|null>",
     "action": "<verb>", "note": "<text>"}

Resolution rules:
- platform/session are AUTO-resolved from the hook-injected `TRELLIS_CONTEXT_ID`
  (`{platform}_{session-id}`); no human input needed.
- model is best-effort only: Claude Code hooks do NOT expose the model name to
  CLI subprocesses, so model comes from an explicit `--model` or the
  `TRELLIS_ACTIVITY_MODEL` env var, else null. platform is the reliable field.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .active_task import _utc_now, resolve_context_key
from .io import read_json, write_json
from .paths import FILE_TASK_JSON

ACTIVITY_FILENAME = "activity.jsonl"

# Documented action verbs (free-form values are still allowed; these are the
# canonical set the phase-transition stamping and onboarding docs reference).
ACTIONS = ("start", "research", "implement", "check", "decision", "handoff", "finish")


def _short_session(context_key: str | None) -> str | None:
    """Short, stable session id from a context key (`{platform}_{id}` → id[:8])."""
    if not context_key or "_" not in context_key:
        return None
    tail = context_key.split("_", 1)[1]
    return tail[:8] or None


def resolve_actor(
    platform: str | None = None,
    model: str | None = None,
    session: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Resolve ``(platform, session, model)`` for the current actor.

    platform: explicit arg > `TRELLIS_CONTEXT_ID` prefix > `AI_AGENT` env > "unknown".
    session:  explicit arg > the context key's session, but ONLY when the
              resolved platform actually owns that context key. When `platform`
              is overridden to a *different* platform than the current session
              (e.g. Claude stamping on Codex's behalf via `--platform codex`),
              the ambient `TRELLIS_CONTEXT_ID` session belongs to Claude, not
              Codex — so session is left None rather than mislabeling it.
    model:    explicit arg > `TRELLIS_ACTIVITY_MODEL` env > None (hooks don't
              expose the model name).
    """
    context_key = resolve_context_key()
    ctx_platform = (
        context_key.split("_", 1)[0] if context_key and "_" in context_key else None
    )

    plat = (platform or "").strip() or ctx_platform
    if not plat:
        ai_agent = os.environ.get("AI_AGENT", "").lower()
        if ai_agent.startswith("claude"):
            plat = "claude"
        elif "codex" in ai_agent:
            plat = "codex"
    if not plat:
        plat = "unknown"

    session_value = (session or "").strip() or None
    if session_value is None and ctx_platform is not None and plat == ctx_platform:
        session_value = _short_session(context_key)

    model_value = (model or "").strip() or os.environ.get(
        "TRELLIS_ACTIVITY_MODEL", ""
    ).strip() or None

    return plat, session_value, model_value


def append_activity(
    task_dir: Path,
    action: str,
    note: str = "",
    *,
    platform: str | None = None,
    model: str | None = None,
    session: str | None = None,
    ts: str | None = None,
) -> dict[str, Any] | None:
    """Append one activity record to ``{task_dir}/activity.jsonl``.

    Auto-resolves platform/session/model. Creates the file if absent (append
    mode). Returns the written record, or None on write failure.
    """
    plat, session_value, model_value = resolve_actor(platform, model, session)
    record: dict[str, Any] = {
        "ts": ts or _utc_now(),
        "platform": plat,
        "model": model_value,
        "session": session_value,
        "action": action,
        "note": note or "",
    }
    path = task_dir / ACTIVITY_FILENAME
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        return None

    # Best-effort provenance roll-up into task.json (never fails the append).
    upsert_task_agent(task_dir, plat, model_value, record["ts"])
    return record


def upsert_task_agent(
    task_dir: Path,
    platform: str,
    model: str | None,
    ts: str,
) -> bool:
    """Record/update this agent in task.json ``meta.agents[]`` (best-effort).

    Keyed by platform: an existing entry's ``last_seen``/``model`` is refreshed;
    otherwise a new ``{platform, model, first_seen, last_seen}`` row is appended.
    Returns False (without raising) when task.json is absent or unreadable, so
    activity logging stays decoupled from task.json health.
    """
    path = task_dir / FILE_TASK_JSON
    data = read_json(path)
    if not isinstance(data, dict):
        return False
    meta = data.setdefault("meta", {})
    if not isinstance(meta, dict):
        return False
    agents = meta.setdefault("agents", [])
    if not isinstance(agents, list):
        return False

    for agent in agents:
        if isinstance(agent, dict) and agent.get("platform") == platform:
            agent["last_seen"] = ts
            if model:
                agent["model"] = model
            break
    else:
        agents.append({
            "platform": platform,
            "model": model,
            "first_seen": ts,
            "last_seen": ts,
        })
    return write_json(path, data)


def read_activity(task_dir: Path) -> list[dict[str, Any]]:
    """Read all activity records from ``{task_dir}/activity.jsonl``.

    Backward-compatible and defensive: a missing file returns ``[]`` and
    malformed lines are skipped (a corrupt line never aborts the read).
    """
    path = task_dir / ACTIVITY_FILENAME
    if not path.is_file():
        return []

    records: list[dict[str, Any]] = []
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return []

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            records.append(obj)
    return records
