<p align="center">
<img src="https://raw.githubusercontent.com/Subaru486desuwa/Polygon/main/assets/polygon-logo.svg" width="140" alt="Polygon logo" />
</p>

<h1 align="center">Polygon</h1>

<p align="center">
<strong>Persistent project memory and a lightweight task workflow for AI coding agents.</strong>
</p>

<p align="center">
<a href="https://github.com/Subaru486desuwa/Polygon/blob/main/README_CN.md">简体中文</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@subaru486/polygon"><img src="https://img.shields.io/npm/v/@subaru486/polygon.svg?style=flat-square&color=2563eb" alt="npm version" /></a>
<a href="https://github.com/Subaru486desuwa/Polygon/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
</p>

---

AI coding agents start every session from scratch — no memory of your conventions, your active work, or what the last session decided. Polygon gives the agent a home inside your repo: a `.polygon/` directory holding specs, tasks, journals and an activity log, plus hooks that feed the right slice of it into every session automatically.

- **Sessions start oriented.** A session-start hook injects who you are, git state, active tasks and the next action — the agent picks up where the last session left off, on any supported platform.
- **The workflow trusts the agent.** Rules are advisory: the agent judges each turn's real size itself. Quick fixes happen inline with no ceremony; multi-turn work gets a task directory, a PRD and a persistent record.
- **Multi-LLM provenance.** Every task carries an `activity.jsonl` recording which platform/model did what, when — Claude Code, Codex and friends can hand work to each other without losing the thread.

## Install

```bash
npm install -g @subaru486/polygon
```

This installs a single `polygon` command. The workflow scripts it deploys are stdlib-only Python, so Python ≥ 3.9 must be on the PATH (`polygon init` checks).

## Quick start

```bash
cd your-project
polygon init -y     # non-interactive: deploys Claude Code + Codex support
```

Or pick platforms explicitly (`polygon init --claude --cursor`), or run `polygon init` with no flags for an interactive checklist. Init deploys:

- `.polygon/` — workflow guide, config, task/spec/journal structure, and the Python scripts that drive them
- Per-platform assets — slash commands, skills, sub-agents and hooks under `.claude/`, `.codex/`, etc.
- `AGENTS.md` — agent instructions at the repo root (a pre-existing file is left untouched; `polygon update` manages only the marked block)
- A git `post-commit` hook that stamps each commit onto the active task's activity log (an existing foreign hook is never overwritten)

Then just open your AI agent in the repo and describe what you want. The injected context tells the agent to judge the turn's size itself:

- Questions and quick fixes → answered inline, no task ceremony.
- Multi-turn implementation work → the agent creates a task, brainstorms a PRD with you, then implements.

## How a session works

| When | What the agent receives |
|---|---|
| Session start | A snapshot: developer, git status, current/active tasks, other live session task pointers, journal state, spec index paths, and a `Next-Action` hint |
| Every message | A few-line `<workflow-state>` breadcrumb keyed on the active task's status (planning / in progress / none) |
| Every git commit | When a task is active, the post-commit hook records `{hash} {subject}` into its `activity.jsonl` (Polygon's own bookkeeping commits are skipped) — silent, never blocks a commit |

Deeper guidance loads on demand: the agent runs `python3 ./.polygon/scripts/get_context.py --mode phase --step <X.Y>` when it actually needs a phase's details, instead of paying for the full guide every session.

## The task workflow

Three phases, each persisted to disk so nothing important lives only in chat history:

| Phase | What happens | Persisted to |
|---|---|---|
| Plan | brainstorm + research → PRD | `.polygon/tasks/<task>/prd.md`, `research/*.md` |
| Execute | implement in the main session; lint / type-check / tests | your code + `activity.jsonl` |
| Finish | capture learnings → commit → archive | `.polygon/spec/`, journal, task archive |

A typical task, usually driven by the agent (you can also run these yourself):

```bash
python3 ./.polygon/scripts/task.py create "Add rate limiting" --slug rate-limiting
# → .polygon/tasks/06-15-rate-limiting/ with task.json (status: planning)
#   ... brainstorm requirements into prd.md ...

python3 ./.polygon/scripts/task.py start 06-15-rate-limiting
# → status: in_progress, this session's active-task pointer set
#   ... implement, test, commit (commits auto-stamp the activity log) ...

python3 ./.polygon/scripts/task.py archive 06-15-rate-limiting
# → status: completed, moved to .polygon/tasks/archive/2026-06/
```

On platforms with slash commands, `/polygon:finish-work` wraps up the active task (archive + journal entry) and `/polygon:continue` resumes it. Other useful subcommands: `current` (show this session's active task), `sessions` (list live session task pointers), `finish` (clear the pointer without archiving), `list`, `list-archive [YYYY-MM]`, and `add-subtask` / `remove-subtask` for task trees.

## What lives in `.polygon/`

| Path | Purpose |
|---|---|
| `workflow.md` | The workflow guide; also the single source for per-turn breadcrumb text |
| `config.yaml` | Project configuration (see below) |
| `spec/` | Layer-scoped coding guidelines; agents read the relevant `index.md` before coding and write new lessons back |
| `tasks/<MM-DD-name>/` | One directory per task: `prd.md`, `task.json`, optional `research/` |
| `tasks/archive/<YYYY-MM>/` | Archived tasks |
| `workspace/<developer>/` | Session journals (`journal-N.md`, auto-rolled around 2,000 lines) |
| `scripts/` | The stdlib-only Python scripts behind everything (`task.py`, `add_session.py`, `get_context.py`, …) |
| `.developer` | Your identity (gitignored) — created by `python3 ./.polygon/scripts/init_developer.py <name>` |

## Multi-LLM activity log

Every task accumulates an append-only `activity.jsonl` — one JSON record per action, resolved to the platform/model that performed it:

```bash
python3 .polygon/scripts/task.py activity-log
# 2026-06-10T04:40:40Z  [claude/-] start: task started
# 2026-06-10T04:40:51Z  [claude/claude-fable-5] implement: archive smoke via updated workflow
# 2026-06-10T04:41:29Z  [claude/-] commit: 03ed140 test(activity): port python suites
# 2026-06-10T04:42:02Z  [codex/-] check: reviewed failover paths
# 2026-06-10T04:43:11Z  [claude/-] finish: task archived
```

`start` (on the planning → in-progress transition), `archive` and git commits stamp automatically; `activity-append` records manual entries (decisions, handoffs):

```bash
python3 .polygon/scripts/task.py activity-append --action decision --note "keep retries at 0"
```

Contributors roll up into `task.json` `meta.agents[]`, and journal entries record an `**Agent**:` line — switch between Claude Code and Codex mid-task, and a later agent reads `activity-log` to learn what its predecessors did and decided, no shared session required.

## Configuration

Everything lives in `.polygon/config.yaml`; all keys are optional:

| Key | Default | Effect |
|---|---|---|
| `session_auto_commit` | `true` | Auto-commit journal entries and task archives (Polygon-owned paths only, never your code) |
| `session_commit_message` | `chore: record journal` | Commit message for journal auto-commits |
| `max_journal_lines` | `2000` | Roll over to a new `journal-N.md` past this length |
| `codex.dispatch_mode` | `inline` | Codex works inline by default; `sub-agent` restores dispatch-style breadcrumbs |
| `ultracode.enabled` | off | Switch breadcrumbs to fan-out variants on platforms with a multi-agent Workflow tool |
| `packages.<name>.path` | — | Declare monorepo packages; specs become per-package (`spec/<package>/`) |
| `default_package` | — | Fallback package when a task doesn't specify one |
| `session.spec_scope` | all | Limit which packages' spec indexes get injected at session start (`active_task` or a list) |
| `update.skip` | — | Template paths `polygon update` should leave alone |
| `hooks.after_create` / `after_start` / `after_finish` / `after_archive` | — | Shell commands after task lifecycle events (e.g. issue-tracker sync) |

## Platform support

`polygon init -y` deploys Claude Code + Codex. Thirteen more platforms are opt-in via flag — each gets the same workflow content in its native format (slash commands, skills, sub-agents, hooks/plugins/extensions):

| Flag | Platform | Lands in |
|---|---|---|
| `--claude` | Claude Code | `.claude/` |
| `--codex` | Codex | `.codex/` + shared `.agents/skills/` |
| `--cursor` | Cursor | `.cursor/` |
| `--opencode` | OpenCode | `.opencode/` (JS plugins) |
| `--gemini` | Gemini CLI | `.gemini/` + shared `.agents/skills/` |
| `--copilot` | GitHub Copilot | `.github/` |
| `--kilo` | Kilo CLI | `.kilocode/` |
| `--kiro` | Kiro | `.kiro/` |
| `--antigravity` | Antigravity | `.agent/` |
| `--windsurf` | Windsurf | `.windsurf/` |
| `--qoder` | Qoder | `.qoder/` |
| `--codebuddy` | CodeBuddy | `.codebuddy/` |
| `--droid` | Factory Droid | `.factory/` |
| `--pi` | Pi Agent | `.pi/` (extension) |
| `--reasonix` | Reasonix | `.reasonix/` (skills) |

## Updating

```bash
polygon update            # preview with --dry-run first if you like
```

Safe by design:

- Your data is never overwritten: `workspace/`, `tasks/` and `.developer` are protected paths, and `spec/` is only refreshed when you've configured a spec registry (`registry.spec.source`).
- Template files you've modified are detected via content hashes and prompt per file — overwrite, skip, or write a `.new` copy (`--force` / `--skip-all` / `--create-new` for non-interactive runs).
- Files you deleted stay deleted; template files the update overwrites are backed up to `.polygon/.backup-<timestamp>/` first (registry-installed `spec/` files excepted — keep those in git).
- Breaking releases ship migrations: run with `--migrate` to apply renames/deletes (`update.skip` is bypassed with a warning on these runs); when a breaking release ships a migration guide, the CLI also creates a migration task with AI-readable instructions.

To remove Polygon entirely: `polygon uninstall` — platform files are removed manifest-driven (only files Polygon wrote), and the whole `.polygon/` directory is deleted with them, including your tasks, specs and journals (commit or export them first). Structured configs like `.claude/settings.json` are scrubbed rather than deleted while they still hold your own settings (`--dry-run` to preview).

## Credits & license

Polygon builds on the task/spec/journal architecture of [Trellis](https://github.com/mindfold-ai/trellis) by Mindfold LLC. Licensed under [AGPL-3.0](https://github.com/Subaru486desuwa/Polygon/blob/main/LICENSE).
