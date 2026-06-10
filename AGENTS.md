# Agent Instructions

Single source of truth for AI assistants (Claude Code reads this via CLAUDE.md `@AGENTS.md`; Codex reads it natively). Hand-maintained in this fork — `polygon update` does not manage this file.

## Project layout

This project is managed by Polygon. Working knowledge lives under `.polygon/`:

- `.polygon/workflow.md` — phases, task lifecycle, breadcrumb contract (read on demand; the per-turn `<workflow-state>` hook carries the current phase's guidance)
- `.polygon/spec/` — layer-scoped coding guidelines; start from the relevant `index.md` before writing code in that layer
- `.polygon/tasks/` — active + archived task records (`prd.md`, `task.json`, `research/`)
- `.polygon/workspace/<developer>/` — session journals

## Workflow conventions

- **Judge task size yourself**: multi-turn implementation work worth a persistent record → `python3 ./.polygon/scripts/task.py create "<title>"`; questions and quick fixes → just do them, no ceremony.
- **Implement in the main session by default.** Sub-agents (`polygon-implement` / `polygon-check` / `polygon-research`) are optional tools for parallelizable or context-heavy chunks, not a required pipeline.
- **Persist over chat**: research, decisions, and lessons go to files under the task dir (`research/*.md`, `prd.md`) — conversations get compacted, files don't.
- Wrap up a finished task with `/polygon:finish-work` (Claude) or `task.py archive` + `add_session.py` (any runtime).

## Hard rules

1. Never silently include dirty files you didn't touch this session in a commit — list them for the user to include/exclude.
2. No `git push`, no `git commit --amend` unless the user explicitly asks.
3. Sub-agents never run `git commit` / `push` / `merge`. Every sub-agent dispatch prompt starts with `Active task: <path from task.py current>`.
4. On Codex, if you ever spawn an agent, always pass `fork_turns="none"` — without it the child inherits the parent transcript and deadlocks on `wait_agent` (#240/#241).

<!-- POLYGON:START -->
# Polygon Instructions

These instructions are for AI assistants working in this project.

This project is managed by Polygon. The working knowledge you need lives under `.polygon/`:

- `.polygon/workflow.md` — development phases, when to create tasks, skill routing
- `.polygon/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.polygon/workspace/` — per-developer journals and session traces
- `.polygon/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Polygon command is available on your platform (e.g. `/polygon:finish-work`, `/polygon:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Polygon skills
- `.codex/agents/` — optional custom subagents

Managed by Polygon. Edits outside this block are preserved; edits inside may be overwritten by a future `polygon update`.

<!-- POLYGON:END -->
