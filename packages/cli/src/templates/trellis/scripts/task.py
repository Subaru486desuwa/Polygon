#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task Management Script.

Usage:
    python3 task.py create "<title>" [--slug <name>] [--assignee <dev>] [--priority P0|P1|P2|P3] [--parent <dir>] [--package <pkg>]
    python3 task.py add-context <dir> <file> <path> [reason] # Add jsonl entry
    python3 task.py validate <dir>              # Validate jsonl files
    python3 task.py list-context <dir>          # List jsonl entries
    python3 task.py start <dir>                 # Set active task
    python3 task.py current [--source]          # Show active task
    python3 task.py finish                      # Clear active task
    python3 task.py activity-append [<dir>] --action <a> [--note <n>]  # Log multi-LLM activity
    python3 task.py activity-log [<dir>]        # Print task activity timeline
    python3 task.py set-branch <dir> <branch>   # Set git branch
    python3 task.py set-base-branch <dir> <branch>  # Set PR target branch
    python3 task.py set-scope <dir> <scope>     # Set scope for PR title
    python3 task.py archive <task-dir>          # Archive completed task
    python3 task.py list                        # List active tasks
    python3 task.py list-archive [month]        # List archived tasks
    python3 task.py add-subtask <parent-dir> <child-dir>     # Link child to parent
    python3 task.py remove-subtask <parent-dir> <child-dir>  # Unlink child from parent
"""

from __future__ import annotations

import argparse
import sys

from common.log import Colors, colored
from common.paths import (
    DIR_WORKFLOW,
    DIR_TASKS,
    FILE_TASK_JSON,
    get_repo_root,
    get_developer,
    get_tasks_dir,
    get_current_task,
)
from common.active_task import (
    clear_active_task,
    resolve_active_task,
    resolve_context_key,
    set_active_task,
)
from common.io import read_json, write_json
from common.activity import append_activity, read_activity
from common.task_utils import resolve_task_dir, run_task_hooks
from common.tasks import iter_active_tasks, children_progress

# Import command handlers from split modules (also re-exports for plan.py compatibility)
from common.task_store import (
    cmd_create,
    cmd_archive,
    cmd_set_branch,
    cmd_set_base_branch,
    cmd_set_scope,
    cmd_add_subtask,
    cmd_remove_subtask,
)
from common.task_context import (
    cmd_add_context,
    cmd_validate,
    cmd_list_context,
)


# =============================================================================
# Command: start / finish
# =============================================================================

def cmd_start(args: argparse.Namespace) -> int:
    """Set active task."""
    repo_root = get_repo_root()
    task_input = args.dir

    if not task_input:
        print(colored("Error: task directory or name required", Colors.RED))
        return 1

    # Resolve task directory (supports task name, relative path, or absolute path)
    full_path = resolve_task_dir(task_input, repo_root)

    if not full_path.is_dir():
        print(colored(f"Error: Task not found: {task_input}", Colors.RED))
        print("Hint: Use task name (e.g., 'my-task') or full path (e.g., '.trellis/tasks/01-31-my-task')")
        return 1

    # Convert to relative path for storage
    try:
        task_dir = full_path.relative_to(repo_root).as_posix()
    except ValueError:
        task_dir = str(full_path)

    task_json_path = full_path / FILE_TASK_JSON

    if not resolve_context_key():
        # Degraded mode: no session identity available.
        # Hook didn't inject TRELLIS_CONTEXT_ID (common on Windows + Claude Code,
        # --continue resume path, fork distribution, hooks disabled, etc.). Skip
        # per-session pointer write; AI continues based on conversation context.
        print(colored(
            "ℹ Session identity not available; active-task pointer not persisted "
            "this session (degraded mode). AI continues based on conversation context.",
            Colors.YELLOW,
        ))
        print(colored(
            "Hint: run inside an AI IDE/session that exposes session identity, "
            "or set TRELLIS_CONTEXT_ID before running task.py start.",
            Colors.YELLOW,
        ))

        # Still flip task.json status: planning → in_progress so downstream phases proceed.
        if task_json_path.is_file():
            data = read_json(task_json_path)
            if data and data.get("status") == "planning":
                data["status"] = "in_progress"
                if write_json(task_json_path, data):
                    print(colored("✓ Status: planning → in_progress (degraded)", Colors.GREEN))
                    append_activity(full_path, "start", "task started (degraded session)")
            run_task_hooks("after_start", task_json_path, repo_root)
        return 0

    active = set_active_task(task_dir, repo_root)
    if active:
        print(colored(f"✓ Current task set to: {task_dir}", Colors.GREEN))
        print(f"Source: {active.source}")

        if task_json_path.is_file():
            data = read_json(task_json_path)
            if data and data.get("status") == "planning":
                data["status"] = "in_progress"
                if write_json(task_json_path, data):
                    print(colored("✓ Status: planning → in_progress", Colors.GREEN))
                    append_activity(full_path, "start", "task started")

        print()
        print(colored("The hook will now inject context from this task's jsonl files.", Colors.BLUE))

        run_task_hooks("after_start", task_json_path, repo_root)
        return 0
    else:
        print(colored("Error: Failed to set current task", Colors.RED))
        return 1


def cmd_finish(args: argparse.Namespace) -> int:
    """Clear active task."""
    repo_root = get_repo_root()
    active = clear_active_task(repo_root)
    current = active.task_path

    if not current:
        print(colored("No current task set", Colors.YELLOW))
        return 0

    # Resolve task.json path before clearing
    task_json_path = repo_root / current / FILE_TASK_JSON

    print(colored(f"✓ Cleared current task (was: {current})", Colors.GREEN))
    print(f"Source: {active.source}")

    if task_json_path.is_file():
        run_task_hooks("after_finish", task_json_path, repo_root)
    return 0


def cmd_current(args: argparse.Namespace) -> int:
    """Show active task."""
    repo_root = get_repo_root()
    active = resolve_active_task(repo_root)

    if args.source:
        print(f"Current task: {active.task_path or '(none)'}")
        print(f"Source: {active.source}")
        if active.stale:
            print("State: stale")
        return 0 if active.task_path else 1

    if active.task_path:
        print(active.task_path)
        return 0

    return 1


# =============================================================================
# Command: activity-append / activity-log (multi-LLM task log)
# =============================================================================

def _resolve_activity_task_dir(task_input: str | None, repo_root):
    """Resolve a task dir for activity commands: explicit arg, else active task."""
    if task_input:
        full = resolve_task_dir(task_input, repo_root)
    else:
        current = get_current_task(repo_root)
        full = (repo_root / current) if current else None
    if full is None or not full.is_dir():
        return None
    return full


def cmd_activity_append(args: argparse.Namespace) -> int:
    """Append one multi-LLM activity record to the task's activity.jsonl."""
    repo_root = get_repo_root()
    full = _resolve_activity_task_dir(args.dir, repo_root)
    if full is None:
        print(colored(
            "Error: no task directory (pass <dir> or run `task.py start` first)",
            Colors.RED,
        ))
        return 1

    record = append_activity(
        full,
        args.action,
        args.note or "",
        platform=args.platform,
        model=args.model,
        session=args.session,
    )
    if record is None:
        print(colored("Error: failed to write activity.jsonl", Colors.RED))
        return 1

    note = record["note"][:60]
    print(colored(
        f"✓ activity: [{record['platform']}] {record['action']}"
        + (f" — {note}" if note else ""),
        Colors.GREEN,
    ))
    return 0


def cmd_activity_log(args: argparse.Namespace) -> int:
    """Print the task's activity.jsonl as a readable timeline."""
    repo_root = get_repo_root()
    full = _resolve_activity_task_dir(args.dir, repo_root)
    if full is None:
        print(colored(
            "Error: no task directory (pass <dir> or run `task.py start` first)",
            Colors.RED,
        ))
        return 1

    records = read_activity(full)
    if not records:
        print(colored("(no activity recorded)", Colors.YELLOW))
        return 0

    for record in records:
        ts = record.get("ts", "?")
        platform = record.get("platform", "?")
        model = record.get("model") or "-"
        action = record.get("action", "?")
        note = record.get("note", "")
        print(f"{ts}  [{platform}/{model}] {action}: {note}")
    return 0


# =============================================================================
# Command: list
# =============================================================================

def cmd_list(args: argparse.Namespace) -> int:
    """List active tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    current_task = get_current_task(repo_root)
    developer = get_developer(repo_root)
    filter_mine = args.mine
    filter_status = args.status

    if filter_mine:
        if not developer:
            print(colored("Error: No developer set. Run init_developer.py first", Colors.RED), file=sys.stderr)
            return 1
        print(colored(f"My tasks (assignee: {developer}):", Colors.BLUE))
    else:
        print(colored("All active tasks:", Colors.BLUE))
    print()

    # Single pass: collect all tasks via shared iterator
    all_tasks = {t.dir_name: t for t in iter_active_tasks(tasks_dir)}
    all_statuses = {name: t.status for name, t in all_tasks.items()}

    # Display tasks hierarchically
    count = 0

    def _print_task(dir_name: str, indent: int = 0) -> None:
        nonlocal count
        t = all_tasks[dir_name]

        # Apply --mine filter
        if filter_mine and (t.assignee or "-") != developer:
            return

        # Apply --status filter
        if filter_status and t.status != filter_status:
            return

        relative_path = f"{DIR_WORKFLOW}/{DIR_TASKS}/{dir_name}"
        marker = ""
        if relative_path == current_task:
            marker = f" {colored('<- current', Colors.GREEN)}"

        # Children progress
        progress = children_progress(t.children, all_statuses)

        # Package tag
        pkg_tag = f" @{t.package}" if t.package else ""

        prefix = "  " * indent + "  - "

        if filter_mine:
            print(f"{prefix}{dir_name}/ ({t.status}){pkg_tag}{progress}{marker}")
        else:
            print(f"{prefix}{dir_name}/ ({t.status}){pkg_tag}{progress} [{colored(t.assignee or '-', Colors.CYAN)}]{marker}")
        count += 1

        # Print children indented
        for child_name in t.children:
            if child_name in all_tasks:
                _print_task(child_name, indent + 1)

    # Display only top-level tasks (those without a parent)
    for dir_name in sorted(all_tasks.keys()):
        if not all_tasks[dir_name].parent:
            _print_task(dir_name)

    if count == 0:
        if filter_mine:
            print("  (no tasks assigned to you)")
        else:
            print("  (no active tasks)")

    print()
    print(f"Total: {count} task(s)")
    return 0


# =============================================================================
# Command: list-archive
# =============================================================================

def cmd_list_archive(args: argparse.Namespace) -> int:
    """List archived tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    archive_dir = tasks_dir / "archive"
    month = args.month

    print(colored("Archived tasks:", Colors.BLUE))
    print()

    if month:
        month_dir = archive_dir / month
        if month_dir.is_dir():
            print(f"[{month}]")
            for d in sorted(month_dir.iterdir()):
                if d.is_dir():
                    print(f"  - {d.name}/")
        else:
            print(f"  No archives for {month}")
    else:
        if archive_dir.is_dir():
            for month_dir in sorted(archive_dir.iterdir()):
                if month_dir.is_dir():
                    month_name = month_dir.name
                    count = sum(1 for d in month_dir.iterdir() if d.is_dir())
                    print(f"[{month_name}] - {count} task(s)")

    return 0


# =============================================================================
# Help
# =============================================================================

def show_usage() -> None:
    """Show usage help."""
    print("""Task Management Script

Usage:
  python3 task.py create <title>                     Create new task directory
  python3 task.py create <title> --package <pkg>     Create task for a specific package
  python3 task.py create <title> --parent <dir>      Create task as child of parent
  python3 task.py add-context <dir> <jsonl> <path> [reason]  Add entry to jsonl
  python3 task.py validate <dir>                     Validate jsonl files
  python3 task.py list-context <dir>                 List jsonl entries
  python3 task.py start <dir>                        Set active task
  python3 task.py current [--source]                 Show active task
  python3 task.py finish                             Clear active task
  python3 task.py activity-append [<dir>] --action <a> [--note <n>]  Log multi-LLM activity
  python3 task.py activity-log [<dir>]               Print task activity timeline
  python3 task.py set-branch <dir> <branch>          Set git branch
  python3 task.py set-base-branch <dir> <branch>     Set PR target branch
  python3 task.py set-scope <dir> <scope>            Set scope for PR title
  python3 task.py archive <task-dir>                 Archive completed task
  python3 task.py add-subtask <parent> <child>       Link child task to parent
  python3 task.py remove-subtask <parent> <child>    Unlink child from parent
  python3 task.py list [--mine] [--status <status>]  List tasks
  python3 task.py list-archive [YYYY-MM]             List archived tasks

Monorepo options:
  --package <pkg>      Package name (validated against config.yaml packages)

List options:
  --mine, -m           Show only tasks assigned to current developer
  --status, -s <s>     Filter by status (planning, in_progress, review, completed)

Examples:
  python3 task.py create "Add login feature" --slug add-login
  python3 task.py create "Add login feature" --slug add-login --package cli
  python3 task.py create "Child task" --slug child --parent .trellis/tasks/01-21-parent
  python3 task.py add-context <dir> implement .trellis/spec/cli/backend/auth.md "Auth guidelines"
  python3 task.py set-branch <dir> task/add-login
  python3 task.py start .trellis/tasks/01-21-add-login
  python3 task.py current --source
  python3 task.py finish
  python3 task.py archive add-login
  python3 task.py add-subtask parent-task child-task  # Link existing tasks
  python3 task.py remove-subtask parent-task child-task
  python3 task.py list                               # List all active tasks
  python3 task.py list --mine                        # List my tasks only
  python3 task.py list --mine --status in_progress   # List my in-progress tasks
""")


# =============================================================================
# Main Entry
# =============================================================================

def main() -> int:
    """CLI entry point."""
    # Deprecation guard: `init-context` was removed in v0.5.0-beta.12.
    # Detect early so argparse doesn't mask the real reason with a generic
    # "invalid choice" error.
    if len(sys.argv) >= 2 and sys.argv[1] == "init-context":
        print(
            colored(
                "Error: `task.py init-context` was removed in v0.5.0-beta.12.",
                Colors.RED,
            ),
            file=sys.stderr,
        )
        print(
            "implement.jsonl / check.jsonl are now seeded on `task.py create` for",
            file=sys.stderr,
        )
        print(
            "sub-agent-capable platforms and curated by the AI during Phase 1.3.",
            file=sys.stderr,
        )
        print("See .trellis/workflow.md Phase 1.3 or run:", file=sys.stderr)
        print(
            "  python3 ./.trellis/scripts/get_context.py --mode phase --step 1.3",
            file=sys.stderr,
        )
        print(
            "Use `task.py add-context <dir> implement|check <path> <reason>` to append entries.",
            file=sys.stderr,
        )
        return 2

    parser = argparse.ArgumentParser(
        description="Task Management Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # create
    p_create = subparsers.add_parser("create", help="Create new task")
    p_create.add_argument("title", help="Task title")
    p_create.add_argument("--slug", "-s", help="Task slug")
    p_create.add_argument("--assignee", "-a", help="Assignee developer")
    p_create.add_argument("--priority", "-p", default="P2", help="Priority (P0-P3)")
    p_create.add_argument("--description", "-d", help="Task description")
    p_create.add_argument("--parent", help="Parent task directory (establishes subtask link)")
    p_create.add_argument("--package", help="Package name for monorepo projects")

    # add-context
    p_add = subparsers.add_parser("add-context", help="Add context entry")
    p_add.add_argument("dir", help="Task directory")
    p_add.add_argument("file", help="JSONL file (implement|check)")
    p_add.add_argument("path", help="File path to add")
    p_add.add_argument("reason", nargs="?", help="Reason for adding")

    # validate
    p_validate = subparsers.add_parser("validate", help="Validate context files")
    p_validate.add_argument("dir", help="Task directory")

    # list-context
    p_listctx = subparsers.add_parser("list-context", help="List context entries")
    p_listctx.add_argument("dir", help="Task directory")

    # start
    p_start = subparsers.add_parser("start", help="Set active task")
    p_start.add_argument("dir", help="Task directory")

    # current
    p_current = subparsers.add_parser("current", help="Show active task")
    p_current.add_argument("--source", action="store_true",
                           help="Show active task source")

    # finish
    subparsers.add_parser("finish", help="Clear active task")

    # activity-append
    p_act_add = subparsers.add_parser(
        "activity-append", help="Append a multi-LLM activity log entry"
    )
    p_act_add.add_argument("dir", nargs="?", help="Task directory (default: active task)")
    p_act_add.add_argument(
        "--action", required=True,
        help="Action verb (start|research|implement|check|decision|handoff|finish|...)",
    )
    p_act_add.add_argument("--note", default="", help="Short human-readable note")
    p_act_add.add_argument("--platform", help="Override platform (default: auto from session)")
    p_act_add.add_argument("--model", help="Model id (default: env TRELLIS_ACTIVITY_MODEL or null)")
    p_act_add.add_argument("--session", help="Override session id (proxy stamping; auto-dropped on cross-platform)")

    # activity-log
    p_act_log = subparsers.add_parser(
        "activity-log", help="Print the task's activity timeline"
    )
    p_act_log.add_argument("dir", nargs="?", help="Task directory (default: active task)")

    # set-branch
    p_branch = subparsers.add_parser("set-branch", help="Set git branch")
    p_branch.add_argument("dir", help="Task directory")
    p_branch.add_argument("branch", help="Branch name")

    # set-base-branch
    p_base = subparsers.add_parser("set-base-branch", help="Set PR target branch")
    p_base.add_argument("dir", help="Task directory")
    p_base.add_argument("base_branch", help="Base branch name (PR target)")

    # set-scope
    p_scope = subparsers.add_parser("set-scope", help="Set scope")
    p_scope.add_argument("dir", help="Task directory")
    p_scope.add_argument("scope", help="Scope name")

    # archive
    p_archive = subparsers.add_parser("archive", help="Archive task")
    p_archive.add_argument("name", help="Task directory or name")
    p_archive.add_argument("--no-commit", action="store_true", help="Skip auto git commit after archive")

    # list
    p_list = subparsers.add_parser("list", help="List tasks")
    p_list.add_argument("--mine", "-m", action="store_true", help="My tasks only")
    p_list.add_argument("--status", "-s", help="Filter by status")

    # add-subtask
    p_addsub = subparsers.add_parser("add-subtask", help="Link child task to parent")
    p_addsub.add_argument("parent_dir", help="Parent task directory")
    p_addsub.add_argument("child_dir", help="Child task directory")

    # remove-subtask
    p_rmsub = subparsers.add_parser("remove-subtask", help="Unlink child task from parent")
    p_rmsub.add_argument("parent_dir", help="Parent task directory")
    p_rmsub.add_argument("child_dir", help="Child task directory")

    # list-archive
    p_listarch = subparsers.add_parser("list-archive", help="List archived tasks")
    p_listarch.add_argument("month", nargs="?", help="Month (YYYY-MM)")

    args = parser.parse_args()

    if not args.command:
        show_usage()
        return 1

    commands = {
        "create": cmd_create,
        "add-context": cmd_add_context,
        "validate": cmd_validate,
        "list-context": cmd_list_context,
        "start": cmd_start,
        "current": cmd_current,
        "finish": cmd_finish,
        "activity-append": cmd_activity_append,
        "activity-log": cmd_activity_log,
        "set-branch": cmd_set_branch,
        "set-base-branch": cmd_set_base_branch,
        "set-scope": cmd_set_scope,
        "archive": cmd_archive,
        "add-subtask": cmd_add_subtask,
        "remove-subtask": cmd_remove_subtask,
        "list": cmd_list,
        "list-archive": cmd_list_archive,
    }

    if args.command in commands:
        return commands[args.command](args)
    else:
        show_usage()
        return 1


if __name__ == "__main__":
    sys.exit(main())
