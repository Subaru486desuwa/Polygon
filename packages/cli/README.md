<h1 align="center">Polygon</h1>

<p align="center">
<strong>A slim, trust-the-agent fork of <a href="https://github.com/mindfoldhq/trellis">Trellis</a> — persistent specs, tasks and multi-LLM activity logs for AI coding, without the ceremony.</strong>
</p>

<p align="center">
<a href="./README_CN.md">简体中文</a> •
<a href="https://docs.trytrellis.app/">Upstream Docs</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@subaru486/polygon"><img src="https://img.shields.io/npm/v/@subaru486/polygon.svg?style=flat-square&color=2563eb" alt="npm version" /></a>
<a href="https://github.com/Subaru486desuwa/Trellis/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/mindfoldhq/trellis"><img src="https://img.shields.io/badge/fork%20of-mindfoldhq%2Ftrellis-6b7280.svg?style=flat-square" alt="fork of trellis" /></a>
</p>

---

AI coding agents start every session from scratch — no memory of your project, your conventions, or what the last session decided. Trellis solves this by persisting specs, tasks and journals into your repo. Polygon keeps that core and removes everything that gets between you and the work:

- **Inline-first.** The main agent edits code directly. No forced sub-agent dispatch, no override phrase allowlists, no anti-rationalization tables. Workflow rules are advisory; the agent (and you) decide what the turn actually needs.
- **Lightweight context injection.** SessionStart payload cut from 27 KB to ~2 KB; per-turn breadcrumbs are 2–4 lines keyed on task status. Long-running daily use costs almost nothing in context.
- **Multi-LLM activity log.** Every task carries an `activity.jsonl` recording which platform/model did what, when — so Claude Code, Codex and friends can hand work to each other with provenance intact.

## Install

```bash
npm install -g @subaru486/polygon
```

This installs three equivalent commands: `polygon`, `trellis`, and `tl`.

## Quick start

```bash
cd your-project
trellis init -y        # deploys the slim claude+codex setup by default
```

Then just describe what you want in your AI coding agent. The injected breadcrumb tells the agent to judge the turn's real size itself:

- Multi-turn implementation work → it creates a task, brainstorms a PRD with you, then implements.
- Questions and quick fixes → answered inline, no task ceremony.

The workflow in three phases:

| Phase | What happens | Persisted to |
|---|---|---|
| Plan | brainstorm + research → PRD | `.trellis/tasks/<task>/prd.md` |
| Execute | implement in the main session; lint / type-check / tests | your code + `activity.jsonl` |
| Finish | capture learnings → commit → archive | `.trellis/spec/`, journal, task archive |

## Multi-LLM activity log

```bash
python3 .trellis/scripts/task.py activity-log
# 2026-06-10T04:40:40Z  [claude/-]               start: task started
# 2026-06-10T04:40:51Z  [claude/claude-fable-5]  implement: archive smoke via updated workflow
# 2026-06-10T04:41:02Z  [claude/-]               finish: task archived
```

`task.py start` and `task.py archive` stamp automatically; `task.py activity-append` records manual entries (decisions, handoffs). `task.json` rolls contributors up into `meta.agents[]`, and journal sessions record an `**Agent**:` line — switch between Claude Code and Codex mid-task without losing who did what.

## How this differs from upstream Trellis

| | Upstream Trellis | Polygon |
|---|---|---|
| Dispatch model | sub-agents mandatory for implement/check | inline by default, sub-agents optional |
| Workflow rules | enforced (override phrases, jsonl gates) | advisory |
| SessionStart payload | ~27 KB | ~2 KB |
| Per-turn breadcrumb | full state block | 2–4 lines |
| Deployed workflow.md | per-platform variants | one ~290-line platform-neutral guide |
| Activity log | — | `activity.jsonl` per task, multi-LLM |
| Default platforms | interactive choice | claude + codex (`-y`) |

Multi-platform assets (Cursor, Gemini CLI, Copilot, …) are retained in the npm package — other platform flags still work and receive the generic slim content.

## Credits & license

Polygon is a fork of [mindfoldhq/trellis](https://github.com/mindfoldhq/trellis) by the Trellis team — the task/spec/journal architecture, multi-platform support and update machinery are theirs. The [upstream docs](https://docs.trytrellis.app/) remain a good reference for core concepts; where behavior differs, this README is authoritative for Polygon.

Licensed under [AGPL-3.0](./LICENSE), same as upstream.
