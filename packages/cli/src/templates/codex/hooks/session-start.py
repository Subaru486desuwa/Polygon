#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Codex Session Start Hook - Inject Polygon context into Codex sessions.

Output format follows Codex hook protocol:
  stdout JSON → { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import warnings
from io import StringIO
from pathlib import Path

# Force UTF-8 on stdin/stdout/stderr on Windows. Default codepage there is
# cp936 / cp1252 / etc. — non-ASCII content (Chinese task names, prd snippets)
# both in stdin (hook payload from host CLI) and stdout (our emitted blocks)
# raises UnicodeDecodeError / UnicodeEncodeError. Equivalent to `python -X utf8`
# but applied per-stream so we don't depend on host CLI's command wiring.
if sys.platform.startswith("win"):
    import io as _io
    for _stream_name in ("stdin", "stdout", "stderr"):
        _stream = getattr(sys, _stream_name, None)
        if _stream is None:
            continue
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
            except Exception:
                pass
        elif hasattr(_stream, "detach"):
            try:
                setattr(sys, _stream_name, _io.TextIOWrapper(_stream.detach(), encoding="utf-8", errors="replace"))
            except Exception:
                pass


def _normalize_windows_shell_path(path_str: str) -> str:
    """Normalize Unix-style shell paths to real Windows paths.

    On Windows, shells like Git Bash / MSYS2 / Cygwin may report paths like
    `/d/Users/...` or `/cygdrive/d/Users/...`. `Path.resolve()` will misinterpret
    these as `D:/d/Users...` on drive D: (or similar), breaking repo root
    detection.

    This function is intentionally conservative: it only rewrites patterns that
    unambiguously represent a drive letter mount.
    """
    if not isinstance(path_str, str) or not path_str:
        return path_str

    # Only relevant on Windows; keep other platforms untouched.
    if not sys.platform.startswith("win"):
        return path_str

    p = path_str.strip()

    # Already a Windows drive path (C:\... or C:/...)
    if re.match(r"^[A-Za-z]:[\/]", p):
        return p

    # MSYS/Git-Bash style: /c/Users/... or /d/Work/...
    m = re.match(r"^/([A-Za-z])/(.*)", p)
    if m:
        drive, rest = m.group(1).upper(), m.group(2)
        rest = rest.replace('/', '\\')
        return f"{drive}:\\{rest}"

    # Cygwin style: /cygdrive/c/Users/...
    m = re.match(r"^/cygdrive/([A-Za-z])/(.*)", p)
    if m:
        drive, rest = m.group(1).upper(), m.group(2)
        rest = rest.replace('/', '\\')
        return f"{drive}:\\{rest}"

    # WSL mounted drive (sometimes leaked into env): /mnt/c/Users/...
    m = re.match(r"^/mnt/([A-Za-z])/(.*)", p)
    if m:
        drive, rest = m.group(1).upper(), m.group(2)
        rest = rest.replace('/', '\\')
        return f"{drive}:\\{rest}"

    return path_str


warnings.filterwarnings("ignore")

SUB_AGENT_NOTICE = """<sub-agent-notice>
SUB-AGENT NOTICE - READ FIRST IF SPAWNED VIA spawn_agent

If your parent session spawned you via spawn_agent with an explicit task
message above this hook output, that message is your only job.
- Execute the parent message exactly as written, then return.
- Ignore all Polygon workflow guidance below this notice.
- Do NOT call task.py start, task.py add-context, or task.py archive.
- Do NOT call wait_agent or spawn_agent.
- Do NOT modify .polygon/tasks/* or any other file unless the parent message
  explicitly asks for that.

If you are the main interactive Codex session and the user is typing at the
terminal with no parent agent, use the workflow guidance below normally.
</sub-agent-notice>"""


def should_skip_injection() -> bool:
    if os.environ.get("POLYGON_HOOKS") == "0":
        return True
    if os.environ.get("POLYGON_DISABLE_HOOKS") == "1":
        return True
    return os.environ.get("CODEX_NON_INTERACTIVE") == "1"


def configure_project_encoding(project_dir: Path) -> None:
    """Reuse Polygon' shared Windows stdio encoding helper before JSON output."""
    scripts_dir = project_dir / ".polygon" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    try:
        from common import configure_encoding  # type: ignore[import-not-found]

        configure_encoding()
    except Exception:
        pass


def read_file(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return fallback


def _resolve_context_key(project_dir: Path, hook_input: dict) -> str | None:
    scripts_dir = project_dir / ".polygon" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.active_task import resolve_context_key  # type: ignore[import-not-found]
    except Exception:
        return None
    return resolve_context_key(hook_input, platform="codex")


def _resolve_active_task(polygon_dir: Path, hook_input: dict):
    scripts_dir = polygon_dir / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from common.active_task import resolve_active_task  # type: ignore[import-not-found]

    return resolve_active_task(polygon_dir.parent, hook_input, platform="codex")


def run_script(script_path: Path, context_key: str | None = None) -> str:
    try:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        if context_key:
            env["POLYGON_CONTEXT_ID"] = context_key
        cmd = [sys.executable, "-W", "ignore", str(script_path)]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            cwd=str(script_path.parent.parent.parent),
            env=env,
        )
        return result.stdout if result.returncode == 0 else "No context available"
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
        return "No context available"


def _normalize_task_ref(task_ref: str) -> str:
    normalized = task_ref.strip()
    if not normalized:
        return ""

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return str(path_obj)

    normalized = normalized.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if normalized.startswith("tasks/"):
        return f".polygon/{normalized}"

    return normalized


def _resolve_task_dir(polygon_dir: Path, task_ref: str) -> Path:
    normalized = _normalize_task_ref(task_ref)
    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return path_obj
    if normalized.startswith(".polygon/"):
        return polygon_dir.parent / path_obj
    return polygon_dir / "tasks" / path_obj


def _get_task_status(polygon_dir: Path, hook_input: dict) -> str:
    active = _resolve_active_task(polygon_dir, hook_input)
    if not active.task_path:
        return (
            f"Status: NO ACTIVE TASK\nSource: {active.source}\n"
            "Next: judge the request's real size — multi-turn implementation work worth a "
            "persistent record gets `python3 ./.polygon/scripts/task.py create`; "
            "questions and quick fixes are handled directly, no ceremony"
        )

    task_ref = active.task_path
    task_dir = _resolve_task_dir(polygon_dir, task_ref)
    if active.stale or not task_dir.is_dir():
        return f"Status: STALE POINTER\nTask: {task_ref}\nSource: {active.source}\nNext: Task directory not found. Run: python3 ./.polygon/scripts/task.py finish"

    task_json_path = task_dir / "task.json"
    task_data: dict = {}
    if task_json_path.is_file():
        try:
            task_data = json.loads(task_json_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, PermissionError):
            pass

    task_title = task_data.get("title", task_ref)
    task_status = task_data.get("status", "unknown")

    if task_status == "completed":
        return f"Status: COMPLETED\nTask: {task_title}\nSource: {active.source}\nNext: Archive with `python3 ./.polygon/scripts/task.py archive {task_dir.name}` or start a new task"

    has_prd = (task_dir / "prd.md").is_file()

    if not has_prd:
        return (
            f"Status: NOT READY\nTask: {task_title}\nSource: {active.source}\n"
            "Missing: prd.md not created\n"
            "Next: iterate prd.md with the user; persist research to `{task_dir}/research/*.md`"
        )

    return (
        f"Status: READY\nTask: {task_title}\n"
        f"Source: {active.source}\n"
        "Next: continue implementation in the main session (read prd.md + research/ first); "
        "verify with lint / type-check / tests before reporting done."
    )


def _build_workflow_toc(workflow_path: Path) -> str:
    """Emit a compact workflow pointer instead of inlining workflow.md.

    The per-turn breadcrumb (inject-workflow-state.py) already carries the
    phase-specific guidance; the full guide stays on disk for on-demand
    reads. Keeping this block tiny is deliberate — session-start injection
    is a per-session token tax.
    """
    if not workflow_path.is_file():
        return "No workflow.md found"
    return (
        "Phase 1: Plan    -> brainstorm + research -> prd.md  (task.py create, then task.py start)\n"
        "Phase 2: Execute -> implement in the main session by default; lint / type-check / tests\n"
        "Phase 3: Finish  -> capture learnings -> commit -> /polygon:finish-work\n"
        "Full guide: .polygon/workflow.md (read on demand)\n"
        "Step detail: python3 ./.polygon/scripts/get_context.py --mode phase --step <X.Y>"
    )


def main() -> None:
    if should_skip_injection():
        sys.exit(0)

    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
        if not isinstance(hook_input, dict):
            hook_input = {}
        project_dir = Path(_normalize_windows_shell_path(hook_input.get("cwd", "."))).resolve()
    except (json.JSONDecodeError, KeyError):
        hook_input = {}
        project_dir = Path(".").resolve()

    configure_project_encoding(project_dir)

    polygon_dir = project_dir / ".polygon"
    context_key = _resolve_context_key(project_dir, hook_input)

    output = StringIO()

    output.write(SUB_AGENT_NOTICE)
    output.write("\n\n")

    output.write("""<session-context>
You are starting a new session in a Polygon-managed project.
Read and follow all instructions below carefully.
</session-context>

""")

    output.write("<current-state>\n")
    context_script = polygon_dir / "scripts" / "get_context.py"
    output.write(run_script(context_script, context_key))
    output.write("\n</current-state>\n\n")

    output.write("<workflow>\n")
    output.write(_build_workflow_toc(polygon_dir / "workflow.md"))
    output.write("\n</workflow>\n\n")

    output.write("<guidelines>\n")
    output.write(
        "Project spec indexes are listed by path below. Each index contains a "
        "**Pre-Development Checklist** listing the specific guideline files to "
        "read before coding. Read the indexes relevant to your change on demand; "
        "when dispatching implement/check sub-agents, curate "
        "`{task}/implement.jsonl` / `check.jsonl` so they get the same context.\n\n"
    )

    # Spec indexes — paths only (read on demand)
    paths: list[str] = []
    spec_dir = polygon_dir / "spec"
    if spec_dir.is_dir():
        for sub in sorted(spec_dir.iterdir()):
            if not sub.is_dir() or sub.name.startswith("."):
                continue
            index_file = sub / "index.md"
            if index_file.is_file():
                paths.append(f".polygon/spec/{sub.name}/index.md")
            else:
                for nested in sorted(sub.iterdir()):
                    if not nested.is_dir():
                        continue
                    nested_index = nested / "index.md"
                    if nested_index.is_file():
                        paths.append(
                            f".polygon/spec/{sub.name}/{nested.name}/index.md"
                        )

    if paths:
        output.write("## Available spec indexes (read on demand)\n")
        for p in paths:
            output.write(f"- {p}\n")
        output.write("\n")

    output.write("</guidelines>\n\n")

    task_status = _get_task_status(polygon_dir, hook_input)
    output.write(f"<task-status>\n{task_status}\n</task-status>\n\n")

    output.write("""<ready>
Context loaded. Project state and guidelines are injected above — do NOT re-read them.
When the user sends the first message, follow <task-status> and use your own judgment on how to proceed.
</ready>""")

    context = output.getvalue()
    result = {
        "suppressOutput": True,
        "systemMessage": f"Polygon context injected ({len(context)} chars)",
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        },
    }

    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
