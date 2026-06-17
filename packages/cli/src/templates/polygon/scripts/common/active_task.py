#!/usr/bin/env python3
"""Session-scoped active task resolution.

The user-facing concept is a single "active task". Polygon stores that pointer
per AI session/window under `.polygon/.runtime/sessions/`; without a stable
session key there is no active task.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DIR_WORKFLOW = ".polygon"
DIR_TASKS = "tasks"
DIR_RUNTIME = ".runtime"
DIR_SESSIONS = "sessions"
DIR_TASK_LOCKS = "task-locks"
DIR_CURSOR_SHELL = "cursor-shell"
TASK_LOCK_GUARD_FILE = ".task-lock-guard.lock"
CURSOR_SHELL_TICKET_TTL_SECONDS = 30
# A single lingering session file from a closed/dead window must not hijack a new
# session's breadcrumb through the single-session fallback. Only inherit a
# fallback session whose last_seen_at is within this window; older pointers are
# treated as abandoned (→ no active task, to be surfaced as resumable rather than
# silently forced onto the next window). Live sessions stay fresh because the
# per-turn breadcrumb hook calls touch_session_last_seen.
SESSION_FALLBACK_MAX_AGE_SECONDS = 1800
TASK_LOCK_LEASE_SECONDS = 900
TASK_SESSION_COMMANDS = {"start", "current", "finish"}

_SESSION_KEYS = ("session_id", "sessionId", "sessionID")
_CONVERSATION_KEYS = ("conversation_id", "conversationId", "conversationID")
_TRANSCRIPT_KEYS = ("transcript_path", "transcriptPath", "transcript")
_NESTED_KEYS = ("input", "properties", "event", "hook_input", "hookInput")
_KNOWN_PLATFORMS = {
    "claude",
    "codex",
    "cursor",
    "opencode",
    "gemini",
    "droid",
    "qoder",
    "codebuddy",
    "kiro",
    "copilot",
    "pi",
}

_ENV_SESSION_KEYS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("claude", ("CLAUDE_SESSION_ID", "CLAUDE_CODE_SESSION_ID")),
    ("codex", ("CODEX_SESSION_ID", "CODEX_THREAD_ID")),
    ("cursor", ("CURSOR_SESSION_ID",)),
    ("opencode", ("OPENCODE_SESSION_ID", "OPENCODE_SESSIONID", "OPENCODE_RUN_ID")),
    ("gemini", ("GEMINI_SESSION_ID",)),
    ("droid", ("FACTORY_SESSION_ID", "DROID_SESSION_ID")),
    ("qoder", ("QODER_SESSION_ID",)),
    ("codebuddy", ("CODEBUDDY_SESSION_ID",)),
    ("kiro", ("KIRO_SESSION_ID",)),
    ("copilot", ("COPILOT_SESSION_ID", "COPILOT_SESSIONID")),
    ("pi", ("PI_SESSION_ID", "PI_SESSIONID")),
)
_ENV_CONVERSATION_KEYS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("cursor", ("CURSOR_CONVERSATION_ID", "CURSOR_CONVERSATIONID")),
)
_ENV_TRANSCRIPT_KEYS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("claude", ("CLAUDE_TRANSCRIPT_PATH",)),
    ("codex", ("CODEX_TRANSCRIPT_PATH",)),
    ("cursor", ("CURSOR_TRANSCRIPT_PATH",)),
    ("gemini", ("GEMINI_TRANSCRIPT_PATH",)),
    ("droid", ("FACTORY_TRANSCRIPT_PATH", "DROID_TRANSCRIPT_PATH")),
    ("qoder", ("QODER_TRANSCRIPT_PATH",)),
    ("codebuddy", ("CODEBUDDY_TRANSCRIPT_PATH",)),
)
_ENV_PLATFORM_ALIASES = {
    "claude-code": "claude",
    "factory": "droid",
    "factory-ai": "droid",
    "github-copilot": "copilot",
}


@dataclass(frozen=True)
class ActiveTask:
    """Resolved active task state."""

    task_path: str | None
    source_type: str
    context_key: str | None = None
    stale: bool = False

    @property
    def source(self) -> str:
        """Human-readable source label."""
        if self.source_type == "session" and self.context_key:
            return f"session:{self.context_key}"
        if self.source_type == "session-fallback" and self.context_key:
            return f"session-fallback:{self.context_key}"
        return self.source_type


@dataclass(frozen=True)
class SessionTaskInfo:
    """Read-only view of one runtime session's active-task pointer."""

    context_key: str
    context_path: Path
    platform: str
    current_task: str | None
    resolved_task_path: str | None
    task_id: str | None
    task_title: str | None
    task_status: str | None
    last_seen_at: str | None
    age_seconds: int | None
    fresh: bool | None
    stale_task: bool


@dataclass(frozen=True)
class TaskLockInfo:
    """Read-only view of one task execution lease."""

    task_path: str
    context_key: str
    platform: str
    acquired_at: str
    expires_at: str
    last_seen_at: str
    age_seconds: int | None
    expires_in_seconds: int | None
    expired: bool


class TaskLockConflict(RuntimeError):
    """Raised when another live session owns a task lease."""

    def __init__(self, lock: TaskLockInfo) -> None:
        super().__init__(
            f"Task is locked by session {lock.context_key} "
            f"[{lock.platform}] until {lock.expires_at}"
        )
        self.lock = lock


def normalize_task_ref(task_ref: str) -> str:
    """Normalize a task ref for stable storage and comparison."""
    normalized = task_ref.strip()
    if not normalized:
        return ""

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return str(path_obj)

    normalized = normalized.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if normalized.startswith(f"{DIR_TASKS}/"):
        return f"{DIR_WORKFLOW}/{normalized}"

    return normalized


def resolve_task_ref(task_ref: str, repo_root: Path) -> Path | None:
    """Resolve a task ref to an absolute task directory."""
    normalized = normalize_task_ref(task_ref)
    if not normalized:
        return None

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return path_obj

    if normalized.startswith(f"{DIR_WORKFLOW}/"):
        return repo_root / path_obj

    return repo_root / DIR_WORKFLOW / DIR_TASKS / path_obj


def _runtime_sessions_dir(repo_root: Path) -> Path:
    return repo_root / DIR_WORKFLOW / DIR_RUNTIME / DIR_SESSIONS


def _task_locks_dir(repo_root: Path) -> Path:
    return repo_root / DIR_WORKFLOW / DIR_RUNTIME / DIR_TASK_LOCKS


def _lock_region(file_obj: Any) -> None:
    if os.name == "nt":
        import msvcrt

        file_obj.seek(0)
        if not file_obj.read(1):
            file_obj.write("0")
            file_obj.flush()
        file_obj.seek(0)
        msvcrt.locking(file_obj.fileno(), msvcrt.LK_LOCK, 1)
        return

    import fcntl

    fcntl.flock(file_obj.fileno(), fcntl.LOCK_EX)


def _unlock_region(file_obj: Any) -> None:
    if os.name == "nt":
        import msvcrt

        file_obj.seek(0)
        msvcrt.locking(file_obj.fileno(), msvcrt.LK_UNLCK, 1)
        return

    import fcntl

    fcntl.flock(file_obj.fileno(), fcntl.LOCK_UN)


@contextmanager
def _task_lock_guard(repo_root: Path) -> Any:
    runtime_dir = repo_root / DIR_WORKFLOW / DIR_RUNTIME
    runtime_dir.mkdir(parents=True, exist_ok=True)
    guard_path = runtime_dir / TASK_LOCK_GUARD_FILE
    with guard_path.open("a+", encoding="utf-8") as guard:
        _lock_region(guard)
        try:
            yield
        finally:
            _unlock_region(guard)


def _task_lock_path(task_ref: str, repo_root: Path) -> Path:
    return _task_locks_dir(repo_root) / f"{_hash_value(task_ref)}.json"


def _sanitize_key(raw: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw.strip())
    safe = safe.strip("._-")
    return safe[:160] if safe else ""


def _hash_value(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _string_value(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _lookup_string(data: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = _string_value(data.get(key))
        if value:
            return value

    for nested_key in _NESTED_KEYS:
        nested = _as_dict(data.get(nested_key))
        if not nested:
            continue
        value = _lookup_string(nested, keys)
        if value:
            return value

    return None


def _detect_platform(platform_input: dict[str, Any] | None, platform: str | None) -> str:
    if platform:
        return _sanitize_key(platform) or "session"
    if platform_input:
        for key in ("_polygon_platform", "polygon_platform", "platform", "source"):
            value = _string_value(platform_input.get(key))
            if value:
                return _sanitize_key(value) or "session"
        if _string_value(platform_input.get("cursor_version")):
            return "cursor"
    return "session"


def _context_key(platform_name: str, kind: str, value: str) -> str:
    if kind == "transcript":
        return f"{platform_name}_transcript_{_hash_value(value)}"
    safe_value = _sanitize_key(value)
    if safe_value:
        return f"{platform_name}_{safe_value}"
    return f"{platform_name}_{_hash_value(value)}"


def _iter_env_keys(
    env_keys: tuple[tuple[str, tuple[str, ...]], ...],
    platform_name: str | None,
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    if not platform_name:
        return env_keys
    matched = tuple((name, keys) for name, keys in env_keys if name == platform_name)
    return matched


def _env_platform_name(platform_name: str | None) -> str | None:
    if not platform_name or platform_name == "session":
        return None
    return _ENV_PLATFORM_ALIASES.get(platform_name, platform_name)


def _lookup_env_context_key(platform_name: str | None) -> str | None:
    """Resolve a context key from platform-provided environment variables.

    Hooks pass `POLYGON_CONTEXT_ID` to subprocesses they launch, but an AI-run
    shell command can only see session identity if the host platform exports it
    in the command environment. These names are best-effort adapters; if none
    are present, there is no session-scoped active task.
    """
    env_platform_name = _env_platform_name(platform_name)

    for name, keys in _iter_env_keys(_ENV_SESSION_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "session", value)

    for name, keys in _iter_env_keys(_ENV_CONVERSATION_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "conversation", value)

    for name, keys in _iter_env_keys(_ENV_TRANSCRIPT_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "transcript", value)

    return None


def _find_repo_root_from_cwd() -> Path | None:
    current = Path.cwd().resolve()
    while True:
        if (current / DIR_WORKFLOW).is_dir():
            return current
        if current == current.parent:
            return None
        current = current.parent


def _cursor_shell_ticket_dir(repo_root: Path) -> Path:
    return repo_root / DIR_WORKFLOW / DIR_RUNTIME / DIR_CURSOR_SHELL


def _remove_file(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _task_refs_match(left: str | None, right: str | None, repo_root: Path) -> bool:
    if not left or not right:
        return False
    left_path = resolve_task_ref(left, repo_root)
    right_path = resolve_task_ref(right, repo_root)
    if left_path is not None and right_path is not None:
        return left_path == right_path
    return normalize_task_ref(left) == normalize_task_ref(right)


def _pending_ticket_matches_args(ticket: dict[str, Any], repo_root: Path) -> bool:
    if Path(sys.argv[0]).name != "task.py":
        return False
    args = tuple(sys.argv[1:])
    if not args:
        return False

    command_name = args[0]
    if command_name not in TASK_SESSION_COMMANDS:
        return False

    subcommands = ticket.get("subcommands")
    if not isinstance(subcommands, list):
        return False

    for subcommand in subcommands:
        if not isinstance(subcommand, dict):
            continue
        if _string_value(subcommand.get("name")) != command_name:
            continue
        if command_name != "start":
            return True
        task_ref = args[1] if len(args) > 1 else None
        if _task_refs_match(_string_value(subcommand.get("task_ref")), task_ref, repo_root):
            return True

    return False


def _ticket_is_fresh(ticket: dict[str, Any], ticket_path: Path, now: float) -> bool:
    expires_at = ticket.get("expires_at_epoch")
    if isinstance(expires_at, (int, float)) and expires_at < now:
        _remove_file(ticket_path)
        return False

    created_at = ticket.get("created_at_epoch")
    if isinstance(created_at, (int, float)):
        if now - created_at <= CURSOR_SHELL_TICKET_TTL_SECONDS:
            return True
        _remove_file(ticket_path)
        return False
    return True


def _ticket_cwd_matches_repo(ticket: dict[str, Any], repo_root: Path) -> bool:
    cwd = _string_value(ticket.get("cwd"))
    if not cwd:
        return True
    try:
        Path(cwd).resolve().relative_to(repo_root)
    except ValueError:
        return False
    return True


def _matching_cursor_ticket_context_key(
    ticket_path: Path,
    repo_root: Path,
    now: float,
) -> str | None:
    ticket = _read_json(ticket_path)
    if ticket is None or ticket.get("platform") != "cursor":
        return None
    if not _ticket_is_fresh(ticket, ticket_path, now):
        return None
    if not _ticket_cwd_matches_repo(ticket, repo_root):
        return None
    if not _pending_ticket_matches_args(ticket, repo_root):
        return None
    return _string_value(ticket.get("context_key"))


def _lookup_cursor_shell_ticket_context_key() -> str | None:
    """Resolve Cursor conversation identity from a short-lived shell ticket.

    Cursor exposes `conversation_id` to `beforeShellExecution`, but does not
    export it into the shell command environment. The Cursor hook writes a
    short-lived ticket just before `task.py` runs. We accept a ticket only when
    the current `task.py` subcommand matches and exactly one fresh context key
    matches, which avoids cross-window pointer contamination.
    """
    repo_root = _find_repo_root_from_cwd()
    if repo_root is None:
        return None

    ticket_dir = _cursor_shell_ticket_dir(repo_root)
    if not ticket_dir.is_dir():
        return None

    now = time.time()
    candidates: set[str] = set()
    for ticket_path in ticket_dir.glob("*.json"):
        context_key = _matching_cursor_ticket_context_key(ticket_path, repo_root, now)
        if context_key:
            candidates.add(context_key)

    if len(candidates) == 1:
        return next(iter(candidates))
    return None


def resolve_context_key(
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> str | None:
    """Resolve a stable session/window context key, if one is available.

    `POLYGON_CONTEXT_ID` is an explicit context-key override used by CLI
    scripts and subprocesses. It does not store the task itself.
    """
    override = _string_value(os.environ.get("POLYGON_CONTEXT_ID"))
    if override:
        return _sanitize_key(override) or _hash_value(override)

    data = _as_dict(platform_input)
    platform_name = _detect_platform(data, platform) if data or platform else None

    if data:
        session_id = _lookup_string(data, _SESSION_KEYS)
        if session_id:
            return _context_key(platform_name or "session", "session", session_id)

        conversation_id = _lookup_string(data, _CONVERSATION_KEYS)
        if conversation_id:
            return _context_key(platform_name or "session", "conversation", conversation_id)

        transcript_path = _lookup_string(data, _TRANSCRIPT_KEYS)
        if transcript_path:
            return _context_key(platform_name or "session", "transcript", transcript_path)

    env_context_key = _lookup_env_context_key(platform_name)
    if env_context_key:
        return env_context_key

    if platform_name in (None, "session", "cursor"):
        return _lookup_cursor_shell_ticket_context_key()
    return None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _write_json(path: Path, data: dict[str, Any]) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return True
    except OSError:
        return False


def _canonical_task_ref(task_path: str, repo_root: Path) -> str | None:
    normalized = normalize_task_ref(task_path)
    if not normalized:
        return None
    full_path = resolve_task_ref(normalized, repo_root)
    if full_path is None or not full_path.is_dir():
        return None
    try:
        return full_path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(full_path)


def _active_from_ref(
    task_ref: str | None,
    repo_root: Path,
    source_type: str,
    context_key: str | None = None,
) -> ActiveTask | None:
    if not task_ref:
        return None
    resolved = resolve_task_ref(task_ref, repo_root)
    stale = resolved is None or not resolved.is_dir()
    return ActiveTask(task_ref, source_type, context_key, stale)


def _context_path(repo_root: Path, context_key: str) -> Path:
    return _runtime_sessions_dir(repo_root) / f"{context_key}.json"


def _task_metadata(task_dir: Path | None) -> tuple[str | None, str | None, str | None]:
    if task_dir is None or not task_dir.is_dir():
        return None, None, None

    data = _read_json(task_dir / "task.json") or {}
    task_id = _string_value(data.get("id")) or task_dir.name
    title = _string_value(data.get("title")) or _string_value(data.get("name"))
    status = _string_value(data.get("status"))
    return task_id, title, status


def _relative_task_path(task_dir: Path | None, repo_root: Path) -> str | None:
    if task_dir is None:
        return None
    try:
        return task_dir.relative_to(repo_root).as_posix()
    except ValueError:
        return str(task_dir)


def _session_age(last_seen_at: str | None, now: float) -> tuple[int | None, bool | None]:
    seen_epoch = _parse_iso_to_epoch(last_seen_at)
    if seen_epoch is None:
        return None, None
    age = max(0, int(now - seen_epoch))
    return age, age <= SESSION_FALLBACK_MAX_AGE_SECONDS


def iter_session_tasks(repo_root: Path) -> list[SessionTaskInfo]:
    """Return read-only active-task pointers for every runtime session file.

    This is an observability API. It never participates in selecting the
    current session's active task, so multi-window isolation stays intact.
    """
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return []

    now = time.time()
    entries: list[SessionTaskInfo] = []
    for session_path in sorted(sessions_dir.glob("*.json")):
        context = _read_json(session_path) or {}
        task_ref = _string_value(context.get("current_task"))
        task_dir = resolve_task_ref(task_ref, repo_root) if task_ref else None
        task_id, title, status = _task_metadata(task_dir)
        last_seen_at = _string_value(context.get("last_seen_at"))
        age_seconds, fresh = _session_age(last_seen_at, now)
        platform = _string_value(context.get("platform")) or "unknown"
        entries.append(
            SessionTaskInfo(
                context_key=session_path.stem,
                context_path=session_path,
                platform=platform,
                current_task=task_ref,
                resolved_task_path=_relative_task_path(task_dir, repo_root),
                task_id=task_id,
                task_title=title,
                task_status=status,
                last_seen_at=last_seen_at,
                age_seconds=age_seconds,
                fresh=fresh,
                stale_task=bool(task_ref and (task_dir is None or not task_dir.is_dir())),
            )
        )

    return entries


def resolve_active_task(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask:
    """Resolve the active task from session runtime state only.

    A stale session task is returned as stale. Missing context identity or a
    missing/empty session context falls back to single-session inference: if
    exactly one session file exists in the runtime, return its task with
    source_type="session-fallback" — covers class-2 platform sub-agents (codex,
    copilot, gemini, qoder) that don't inherit the parent's session id. ≥2
    files or 0 files yield ActiveTask(None) — refuses to guess across windows.
    """
    context_key = resolve_context_key(platform_input, platform)
    if context_key:
        context = _read_json(_context_path(repo_root, context_key)) or {}
        task_ref = _string_value(context.get("current_task"))
        active = _active_from_ref(task_ref, repo_root, "session", context_key)
        if active:
            return active

    fallback = _resolve_single_session_fallback(repo_root)
    if fallback is not None:
        return fallback

    return ActiveTask(None, "none", context_key)


def _resolve_single_session_fallback(repo_root: Path) -> ActiveTask | None:
    """Return the task pointed at by the sole session file, if exactly one exists.

    Used when context-key resolution fails (typical for class-2 platform
    sub-agents). Returns None if 0 or ≥2 session files are present — refuses
    to pick across windows so 04-21's multi-session isolation contract holds.
    """
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return None

    session_files = sorted(sessions_dir.glob("*.json"))
    if len(session_files) != 1:
        return None

    session_file = session_files[0]
    context = _read_json(session_file) or {}
    task_ref = _string_value(context.get("current_task"))
    if not task_ref:
        return None

    # Staleness gate: a fallback session file older than the freshness window is
    # an abandoned/closed window. Don't auto-inherit its task into a new session
    # (the "dead session hijacks the live breadcrumb" wart). Files without a
    # parseable last_seen_at keep the legacy inherit behaviour (fail-open).
    last_seen = _parse_iso_to_epoch(_string_value(context.get("last_seen_at")))
    if last_seen is not None and (time.time() - last_seen) > SESSION_FALLBACK_MAX_AGE_SECONDS:
        return None

    fallback_key = session_file.stem
    return _active_from_ref(task_ref, repo_root, "session-fallback", fallback_key)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso_to_epoch(ts: str | None) -> float | None:
    """Parse an ISO-8601 timestamp (as written by _utc_now) to epoch seconds."""
    if not ts or not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.strip().replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def _utc_from_epoch(epoch: float) -> str:
    return (
        datetime.fromtimestamp(epoch, timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _lock_expiry(now: float | None = None) -> str:
    now = time.time() if now is None else now
    return _utc_from_epoch(now + TASK_LOCK_LEASE_SECONDS)


def _task_lock_info(data: dict[str, Any], now: float, current_context_key: str | None) -> TaskLockInfo | None:
    task_path = _string_value(data.get("task_path"))
    context_key = _string_value(data.get("context_key"))
    platform = _string_value(data.get("platform")) or "unknown"
    acquired_at = _string_value(data.get("acquired_at"))
    expires_at = _string_value(data.get("expires_at"))
    last_seen_at = _string_value(data.get("last_seen_at")) or acquired_at
    if not task_path or not context_key or not acquired_at or not expires_at or not last_seen_at:
        return None

    acquired_epoch = _parse_iso_to_epoch(acquired_at)
    expires_epoch = _parse_iso_to_epoch(expires_at)
    age_seconds = None if acquired_epoch is None else max(0, int(now - acquired_epoch))
    expires_in = None if expires_epoch is None else int(expires_epoch - now)
    expired = True if expires_epoch is None else expires_epoch <= now
    return TaskLockInfo(
        task_path=task_path,
        context_key=context_key,
        platform=platform,
        acquired_at=acquired_at,
        expires_at=expires_at,
        last_seen_at=last_seen_at,
        age_seconds=age_seconds,
        expires_in_seconds=expires_in,
        expired=expired,
    )


def iter_task_locks(repo_root: Path, current_context_key: str | None = None) -> list[TaskLockInfo]:
    """Return read-only task execution leases."""
    locks_dir = _task_locks_dir(repo_root)
    if not locks_dir.is_dir():
        return []

    now = time.time()
    entries: list[TaskLockInfo] = []
    for lock_path in sorted(locks_dir.glob("*.json")):
        lock = _read_json(lock_path)
        if lock is None:
            continue
        info = _task_lock_info(lock, now, current_context_key)
        if info is not None:
            entries.append(info)
    return sorted(entries, key=lambda entry: entry.task_path)


def _clear_locks_for_context_unlocked(
    context_key: str,
    repo_root: Path,
    keep_task_path: str | None = None,
) -> int:
    cleared = 0
    locks_dir = _task_locks_dir(repo_root)
    if not locks_dir.is_dir():
        return cleared

    for lock_path in locks_dir.glob("*.json"):
        lock = _read_json(lock_path) or {}
        if _string_value(lock.get("context_key")) != context_key:
            continue
        if keep_task_path and _string_value(lock.get("task_path")) == keep_task_path:
            continue
        if _remove_file(lock_path):
            cleared += 1
    return cleared


def acquire_task_lock(
    task_path: str,
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
    *,
    force_takeover: bool = False,
) -> TaskLockInfo | None:
    """Acquire the task execution lease for the current session.

    Returns None when no context key is available, matching set_active_task.
    Raises TaskLockConflict when another unexpired session owns the lease.
    """
    canonical = _canonical_task_ref(task_path, repo_root)
    if canonical is None:
        return None

    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return None

    metadata = _context_metadata(platform_input, platform, context_key)
    platform_name = _string_value(metadata.get("platform")) or "session"
    lock_path = _task_lock_path(canonical, repo_root)

    with _task_lock_guard(repo_root):
        existing = _read_json(lock_path)
        now = time.time()
        if existing:
            existing_info = _task_lock_info(existing, now, context_key)
            if (
                existing_info
                and existing_info.context_key != context_key
                and not existing_info.expired
                and not force_takeover
            ):
                raise TaskLockConflict(existing_info)

        acquired_at = _utc_from_epoch(now)
        lock_data = {
            "task_path": canonical,
            "context_key": context_key,
            "platform": platform_name,
            "acquired_at": acquired_at,
            "expires_at": _lock_expiry(now),
            "last_seen_at": acquired_at,
        }
        if not _write_json(lock_path, lock_data):
            return None
        _clear_locks_for_context_unlocked(context_key, repo_root, keep_task_path=canonical)
        info = _task_lock_info(lock_data, now, context_key)
        return info


def release_task_lock(
    task_path: str,
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> bool:
    """Release the current session's lease for a task."""
    target = _canonical_task_ref(task_path, repo_root) or normalize_task_ref(task_path)
    context_key = resolve_context_key(platform_input, platform)
    if not target or not context_key:
        return False
    lock_path = _task_lock_path(target, repo_root)
    if not lock_path.is_file():
        return False

    with _task_lock_guard(repo_root):
        lock = _read_json(lock_path)
        if not lock or _string_value(lock.get("context_key")) != context_key:
            return False
        return _remove_file(lock_path)


def clear_task_from_locks(task_path: str, repo_root: Path) -> int:
    """Delete all task leases that point at a task."""
    target = _canonical_task_ref(task_path, repo_root) or normalize_task_ref(task_path)
    if not target:
        return 0

    locks_dir = _task_locks_dir(repo_root)
    if not locks_dir.is_dir():
        return 0

    cleared = 0
    with _task_lock_guard(repo_root):
        for lock_path in locks_dir.glob("*.json"):
            lock = _read_json(lock_path) or {}
            current = _string_value(lock.get("task_path"))
            if not current:
                continue
            current_ref = _canonical_task_ref(current, repo_root) or normalize_task_ref(current)
            if current_ref != target:
                continue
            if _remove_file(lock_path):
                cleared += 1
    return cleared


def _refresh_task_lock_for_context(repo_root: Path, context_key: str, task_path: str) -> None:
    target = _canonical_task_ref(task_path, repo_root) or normalize_task_ref(task_path)
    if not target:
        return
    lock_path = _task_lock_path(target, repo_root)
    if not lock_path.is_file():
        return
    with _task_lock_guard(repo_root):
        lock = _read_json(lock_path)
        if not lock or _string_value(lock.get("context_key")) != context_key:
            return
        now = time.time()
        lock["last_seen_at"] = _utc_from_epoch(now)
        lock["expires_at"] = _lock_expiry(now)
        _write_json(lock_path, lock)


def touch_session_last_seen(repo_root: Path, context_key: str | None) -> None:
    """Refresh last_seen_at on an existing session file so a live session stays
    inside the fallback freshness window (SESSION_FALLBACK_MAX_AGE_SECONDS).

    No-op when the file is absent — we never create a session file here; only
    set_active_task does. Called once per turn by the breadcrumb hook.
    """
    if not context_key:
        return
    path = _context_path(repo_root, context_key)
    context = _read_json(path)
    if context is None:
        return
    context["last_seen_at"] = _utc_now()
    _write_json(path, context)
    task_path = _string_value(context.get("current_task"))
    if task_path:
        _refresh_task_lock_for_context(repo_root, context_key, task_path)


def _context_metadata(
    platform_input: dict[str, Any] | None,
    platform: str | None,
    context_key: str | None = None,
) -> dict[str, Any]:
    data = _as_dict(platform_input) or {}
    platform_name = _detect_platform(data, platform)
    if platform_name == "session" and context_key:
        prefix = context_key.split("_", 1)[0]
        if prefix in _KNOWN_PLATFORMS:
            platform_name = prefix
    metadata: dict[str, Any] = {
        "platform": platform_name,
        "last_seen_at": _utc_now(),
    }
    for key in (*_SESSION_KEYS, *_CONVERSATION_KEYS, *_TRANSCRIPT_KEYS):
        value = _lookup_string(data, (key,))
        if value:
            metadata[key] = value
    return metadata


def set_active_task(
    task_path: str,
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask | None:
    """Set the active task in session scope.

    Returns None when no context key is available; callers should surface a
    user-facing error that explains how to provide session identity.
    """
    canonical = _canonical_task_ref(task_path, repo_root)
    if canonical is None:
        return None

    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return None

    context_path = _context_path(repo_root, context_key)
    context = _read_json(context_path) or {}
    context.update(_context_metadata(platform_input, platform, context_key))
    context["current_task"] = canonical
    context.setdefault("current_run", None)
    if not _write_json(context_path, context):
        return None
    return ActiveTask(canonical, "session", context_key)


def clear_active_task(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask:
    """Clear the active task by deleting the current session context file."""
    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return ActiveTask(None, "none")

    previous = resolve_active_task(repo_root, platform_input, platform)
    context_path = _context_path(repo_root, context_key)
    if context_path.is_file():
        _remove_file(context_path)
    if previous.task_path:
        release_task_lock(previous.task_path, repo_root, platform_input, platform)
    return previous


def clear_task_from_sessions(task_path: str, repo_root: Path) -> int:
    """Delete all session runtime files that point at a task."""
    target = _canonical_task_ref(task_path, repo_root) or normalize_task_ref(task_path)
    if not target:
        return 0

    cleared = 0
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return cleared

    for session_path in sessions_dir.glob("*.json"):
        context = _read_json(session_path) or {}
        current = _string_value(context.get("current_task"))
        if not current:
            continue
        current_ref = _canonical_task_ref(current, repo_root) or normalize_task_ref(current)
        if current_ref != target:
            continue
        if session_path.is_file() and _remove_file(session_path):
            cleared += 1

    return cleared


def get_current_task_source(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Return (`source_type`, `context_key`, `task_path`) for compatibility."""
    active = resolve_active_task(repo_root, platform_input, platform)
    return active.source_type, active.context_key, active.task_path
