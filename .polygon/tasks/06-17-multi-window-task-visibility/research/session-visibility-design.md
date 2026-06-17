# Research: Multi-Window Task Visibility

## Scope
Internal source inspection for exposing live per-session task pointers without changing current-task resolution.

## Findings

### Current Polygon runtime
* `packages/cli/src/templates/polygon/scripts/common/active_task.py:475-501` resolves only the current session's context key, with a single-session fallback when exactly one runtime session exists.
* `packages/cli/src/templates/polygon/scripts/common/active_task.py:504-534` refuses fallback when two or more session files exist, which preserves the multi-window isolation contract.
* `packages/cli/src/templates/polygon/scripts/common/session_context.py:550-576` shows only the current session's active task.
* `packages/cli/src/templates/polygon/scripts/task.py:170-186` exposes `task.py current`, but there is no command to list every runtime session pointer.

### Historical contract
* `.polygon/tasks/04-21-session-scoped-task-state/prd.md` defines active task as per-session/window state and explicitly rejects a global `.current-task` fallback.
* The same PRD names stale session files as a known risk and says future work can use `last_seen_at` for diagnostics/pruning.

### Trellis comparison
* Upstream Trellis at `mindfold-ai/trellis` HEAD `29b5141b80bee0d362c58592cc335379a838c862` still has session-scoped active-task files under `.trellis/.runtime/sessions/`.
* The upstream `trellis mem` commands list AI transcript sessions, not workflow active-task pointers. They are useful inspiration for "list sessions", but they do not solve live task visibility for `.runtime/sessions/*.json`.

### Rust option
Rust is not a good first implementation for this slice. The affected runtime is copied into user projects as stdlib-only Python template scripts. A Rust binary would introduce build/distribution/versioning work for a small JSON-directory aggregation feature. Keeping the aggregator in `common.active_task` also reuses the exact task-ref normalization and stale-task logic that current resolution already uses.

## Recommended implementation
1. Add `SessionTaskInfo` dataclass and `iter_session_tasks(repo_root)` to `common.active_task`.
2. Have each entry report context key, source file, platform, current task ref, canonical task path when available, task status/title, `last_seen_at`, `age_seconds`, freshness, and stale task state.
3. Add a `LIVE SESSIONS` section to default and record `get_context.py` text output, and add `liveSessions` to JSON output.
4. Add `task.py sessions [--json]` as the direct debugging command.
5. Add regression tests that prove multi-session listing works and `task.py current --source` still returns none when multiple session files exist and no exact context key is available.
