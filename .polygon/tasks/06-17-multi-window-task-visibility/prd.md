# Improve Multi-Window Task Visibility

## Goal
Make parallel AI windows in the same checkout visible to each other without weakening Polygon's session-scoped active-task isolation. A new window should be able to see which live sessions currently point at which tasks, while `task.py current` and breadcrumbs continue to resolve only the current session's task.

## Requirements
* Keep `active task = current AI session/window task`. Do not reintroduce a repo-global `.current-task` fallback.
* Add a read-only live-session view over `.polygon/.runtime/sessions/*.json`.
* Surface that view in the normal `get_context.py` session context so fresh windows see other ongoing work at startup.
* Add a direct CLI command for debugging the same view.
* Treat missing/corrupt/stale session files as advisory data issues, not active-task resolution errors.
* Use Python stdlib template scripts, not Rust, for this runtime path.

## Acceptance Criteria
* [x] `python3 ./.polygon/scripts/get_context.py` includes a "LIVE SESSIONS" section when runtime sessions exist.
* [x] The section marks the current session and shows task path, task status/name, platform, source context key, last seen, and stale task state.
* [x] `python3 ./.polygon/scripts/task.py sessions` prints the same live-session registry.
* [x] `python3 ./.polygon/scripts/task.py sessions --json` emits machine-readable session entries.
* [x] `task.py current --source` behavior is unchanged: multiple session files still do not pick a random current task.
* [x] Template scripts and dogfood `.polygon/scripts/` stay in sync for changed files.
* [x] Regression tests cover multi-session visibility and current-task isolation.
* [x] Regression tests cover real multi-process `task.py start` races: same-task contention yields one owner, while different-task starts remain independently visible.

## Decision (ADR-lite)

Context: task `04-21-session-scoped-task-state` intentionally moved active task from global `.current-task` to per-session `.polygon/.runtime/sessions/<context>.json` to prevent two AI windows from overwriting each other's current task. The current gap is visibility: when multiple windows are active, each window can only see its own current task unless it manually inspects runtime files.

Decision: add a read-only `SessionTaskInfo` enumeration API to `common.active_task`, then use it from `session_context.py` and `task.py sessions`. The API never changes the resolver's selection rules. It only reports runtime session files and resolved task metadata.

Consequences: multi-window users get real-time awareness without cross-window pointer contamination. Stale runtime files remain visible for diagnosis instead of silently driving `current` resolution. The implementation stays in Python because these scripts are copied into user repos and expected to run without build steps or native binaries.

## Out of Scope
* Replacing template scripts with Rust or adding native binaries.
* Changing how `resolve_active_task()` chooses the current task.
* Auto-pruning stale session files.
* Reading external AI transcript/session stores.

## Research References
* `research/session-visibility-design.md` - source inspection and Trellis comparison.

## Technical Notes
* Existing runtime shape is `.polygon/.runtime/sessions/<context-key>.json` with `current_task`, `platform`, `last_seen_at`, and `current_run`.
* `SESSION_FALLBACK_MAX_AGE_SECONDS` already defines the freshness window used by single-session fallback. Reuse it for a `fresh/stale` display classification only.
* Task execution leases live under `.polygon/.runtime/task-locks/` and are serialized by `.polygon/.runtime/.task-lock-guard.lock`; this remains Python stdlib-only production behavior.
* Do not touch unrelated dirty files: `.codex/config.toml`, `drafts/logo-preview.cjs`, `drafts/trellis-residual-gems.md`.
