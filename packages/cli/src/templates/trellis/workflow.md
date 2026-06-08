# Development Workflow

---

## Core Principles

1. **Plan before code** — figure out what to do before you start
2. **Specs injected, not remembered** — guidelines are injected via hook/skill, not recalled from memory
3. **Persist everything** — research, decisions, and lessons all go to files; conversations get compacted, files don't
4. **Incremental development** — one task at a time
5. **Capture learnings** — after each task, review and write new knowledge back to spec

---

## Trellis System

### Developer Identity

On first use, initialize your identity:

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

Creates `.trellis/.developer` (gitignored) + `.trellis/workspace/<your-name>/`.

### Spec System

`.trellis/spec/` holds coding guidelines organized by package and layer.

- `.trellis/spec/<package>/<layer>/index.md` — entry point with **Pre-Development Checklist** + **Quality Check**. Actual guidelines live in the `.md` files it points to.
- `.trellis/spec/guides/index.md` — cross-package thinking guides.

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # list packages / layers
```

**When to update spec**: new pattern/convention found · bug-fix prevention to codify · new technical decision.

### Task System

Every task has its own directory under `.trellis/tasks/{MM-DD-name}/` holding `prd.md`, `implement.jsonl`, `check.jsonl`, `task.json`, optional `research/`, `info.md`.

```bash
# Task lifecycle
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py start <name>          # set active task (session-scoped when available)
python3 ./.trellis/scripts/task.py current --source      # show active task and source
python3 ./.trellis/scripts/task.py finish                # clear active task (triggers after_finish hooks)
python3 ./.trellis/scripts/task.py archive <name>        # move to archive/{year-month}/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]
python3 ./.trellis/scripts/task.py list-archive

# Code-spec context (injected into implement/check agents via JSONL).
# `implement.jsonl` / `check.jsonl` are seeded on `task create` for sub-agent-capable
# platforms; the AI curates real spec + research entries during Phase 1.3.
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py list-context <name> [action]
python3 ./.trellis/scripts/task.py validate <name>

# Task metadata
python3 ./.trellis/scripts/task.py set-branch <name> <branch>
python3 ./.trellis/scripts/task.py set-base-branch <name> <branch>    # PR target
python3 ./.trellis/scripts/task.py set-scope <name> <scope>

# Hierarchy (parent/child)
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py remove-subtask <parent> <child>

# PR creation
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

> Run `python3 ./.trellis/scripts/task.py --help` to see the authoritative, up-to-date list.

**Current-task mechanism**: `task.py create` creates the task directory and (when session identity is available) auto-sets the per-session active-task pointer so the planning breadcrumb fires immediately. `task.py start` writes the same pointer (idempotent if already set) and flips `task.json.status` from `planning` to `in_progress`. State is stored under `.trellis/.runtime/sessions/`. If no context key is available from hook input, `TRELLIS_CONTEXT_ID`, or a platform-native session environment variable, there is no active task and `task.py start` fails with a session identity hint. `task.py finish` deletes the current session file (status unchanged). `task.py archive <task>` writes `status=completed`, moves the directory to `archive/`, and deletes any runtime session files that still point at the archived task.

### Workspace System

Records every AI session for cross-session tracking under `.trellis/workspace/<developer>/`.

- `journal-N.md` — session log. **Max 2000 lines per file**; a new `journal-(N+1).md` is auto-created when exceeded.
- `index.md` — personal index (total sessions, last active).

```bash
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "hash" --summary "Summary"
```

### Context Script

```bash
python3 ./.trellis/scripts/get_context.py                            # full session runtime
python3 ./.trellis/scripts/get_context.py --mode packages            # available packages + spec layers
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>  # detailed guide for a workflow step
```

---

<!--
  WORKFLOW-STATE BREADCRUMB CONTRACT (read this before editing the tag blocks below)

  The 4 [workflow-state:STATUS] blocks embedded in the ## Phase Index section
  below are the SINGLE source of truth for the per-turn `<workflow-state>`
  breadcrumb that every supported AI platform's UserPromptSubmit hook
  reads. inject-workflow-state.py (Python platforms) and
  inject-workflow-state.js (OpenCode plugin) only parse them — there is no
  fallback dict baked into the scripts after v0.5.0-rc.0.

  STATUS charset: [A-Za-z0-9_-]+. When the hook can't find a tag, it
  degrades to a generic "Refer to workflow.md for current step." line —
  intentionally visible so users notice and fix a broken workflow.md.

  INVARIANT (test/regression.test.ts):
    Every workflow-walkthrough step marked `[required · once]` must have a
    matching enforcement line in its phase's [workflow-state:*] block. The
    breadcrumb is the only per-turn channel; if a mandatory step isn't
    mentioned there, the AI silently skips it (Phase 1.3 jsonl curation
    skip and Phase 3.4 commit skip both manifested via this gap).

  TAG ↔ PHASE scoping:
    [workflow-state:no_task]      → no active task; before Phase 1
    [workflow-state:planning]     → all of Phase 1 (status='planning')
    [workflow-state:in_progress]  → Phase 2 + Phase 3.1-3.4
                                    (status stays 'in_progress' from
                                    task.py start until task.py archive)
    [workflow-state:completed]    → currently DEAD: cmd_archive flips
                                    status and moves the dir in the same
                                    call, so the resolver loses the
                                    pointer (block kept for a future
                                    explicit in_progress→completed
                                    transition)

  DISPATCH-MODE VARIANTS (resolve_breadcrumb_key picks one per platform/config):
    [workflow-state:<status>-inline] → codex inline dispatch_mode (main session
                                       edits code directly); codex-only.
    [workflow-state:<status>-ultra]  → ultracode fan-out (config
                                       ultracode.enabled), class-1 platforms
                                       only. Only planning / in_progress carry
                                       ultra bodies; any other <status>-ultra
                                       falls back to the base status via
                                       build_breadcrumb. Codex and ultracode are
                                       mutually exclusive — resolve_breadcrumb_key
                                       returns inside the codex branch before the
                                       ultracode check, so no -inline-ultra
                                       combination ever exists.

  Editing checklist:
    - When you change a [workflow-state:STATUS] block, also check the
      matching phase's `[required · once]` walkthrough steps for sync
    - Run `trellis update` after editing to push the new bodies to
      downstream user projects (block-level managed replacement)
    - Full runtime contract:
      .trellis/spec/cli/backend/workflow-state-contract.md
-->

## Phase Index

```
Phase 1: Plan    → figure out what to do (brainstorm + research → prd.md)
Phase 2: Execute → write code and pass quality checks
Phase 3: Finish  → distill lessons + wrap-up
```

<!-- Per-turn breadcrumb: shown when there is no active task (before Phase 1) -->

[workflow-state:no_task]
No active task. **A Direct answer** — pure Q&A / explanation / lookup / chat; no file writes + one-line answer + repo reads ≤ 2 files → AI judges, no override needed.
**B Create a task** — any implementation / code change / build / refactor work. Entry sequence: (1) `python3 ./.trellis/scripts/task.py create "<title>"` to create the task (status=planning, breadcrumb switches to [workflow-state:planning] for brainstorm + jsonl phase guidance) → (2) load `trellis-brainstorm` skill to discuss requirements with the user and iterate on prd.md → (3) once prd is done and jsonl is curated, run `task.py start <task-dir>` to enter [workflow-state:in_progress] for the implementation skeleton. **"It looks small" is NOT grounds for downgrading B to A or C**.
**C Inline change** (per-turn only, escape hatch for B) — the user's CURRENT message MUST contain one of: "skip trellis" / "no task" / "just do it" / "don't create a task" / "跳过 trellis" / "别走流程" / "小修一下" / "直接改" / "先别建任务" → briefly acknowledge ("ok, skipping trellis flow this turn"), then inline. **Without seeing one of these phrases you must NOT inline on your own**; do not invent an override the user never said.
[/workflow-state:no_task]

### Phase 1: Plan
- 1.0 Create task `[required · once]` (just `task.py create`; status enters planning)
- 1.1 Requirement exploration `[required · repeatable]`
- 1.2 Research `[optional · repeatable]`
- 1.3 Configure context `[required · once]` — Claude Code, Cursor, OpenCode, Codex, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi
- 1.4 Activate task `[required · once]` (run `task.py start`; status → in_progress)
- 1.5 Completion criteria

<!-- Per-turn breadcrumb: shown throughout Phase 1 (status='planning') -->

[workflow-state:planning]
Load the `trellis-brainstorm` skill and iterate on prd.md with the user.
Phase 1.3 (required, once): before `task.py start`, you MUST curate `implement.jsonl` and `check.jsonl` — list the spec / research files sub-agents need so they get the right context injected. You may skip only if the jsonl already has agent-curated entries (the seed `_example` row alone doesn't count).
Then run `task.py start <task-dir>` to flip status to in_progress.
**Ultracode**: if this turn shows an "Ultracode is on" system-reminder (single-turn ultracode without `ultracode.enabled` in config), switch to fan-out per the "Trellis × Ultracode" section — research fans out, but the Phase 1.3 jsonl curation above still applies. This overrides the single-pass default for this turn only.
[/workflow-state:planning]

<!-- Per-turn breadcrumb: shown throughout Phase 1 when codex.dispatch_mode=inline.
     Codex-only opt-in alternate to [workflow-state:planning]. The main agent
     edits code directly in Phase 2, so Phase 1.3 jsonl curation is skipped —
     the inline workflow loads `trellis-before-dev` instead of injecting JSONL
     into a sub-agent. -->

[workflow-state:planning-inline]
Load the `trellis-brainstorm` skill and iterate on prd.md with the user.
Phase 1.3 jsonl curation is **skipped** in inline dispatch mode — the main session loads `trellis-before-dev` directly in Phase 2 and reads spec context itself, so there is no sub-agent to inject jsonl into.
Then run `task.py start <task-dir>` to flip status to in_progress.
[/workflow-state:planning-inline]

<!-- Per-turn breadcrumb: shown throughout Phase 1 when ultracode is on
     (config ultracode.enabled, resolved by inject-workflow-state.py's
     resolve_breadcrumb_key for class-1 platforms). Ultracode fan-out
     variant of [workflow-state:planning]: research fans out via the Workflow
     tool. Phase 1.3 jsonl curation is still required (regression invariant). -->

[workflow-state:planning-ultra]
Load the `trellis-brainstorm` skill and iterate on prd.md with the user.
**Ultracode is on — research fans out**: when a topic has independent sub-questions, dispatch MULTIPLE `trellis-research` sub-agents in parallel (one per angle) via the Workflow tool instead of a single serial pass. Each dispatch prompt MUST still start with `Active task: <task path from \`task.py current\`>` so each agent resolves its own `{task_dir}/research/` to write into. See the "Trellis × Ultracode" section for the fan-out protocol. (If the Workflow tool is unavailable, fall back to several sequential `trellis-research` dispatches.)
Phase 1.3 (required, once): before `task.py start`, you MUST curate `implement.jsonl` and `check.jsonl` — list the spec / research files sub-agents need so they get the right context injected. Fan-out does not change this: curate the jsonl AFTER the parallel research lands, folding in every `{task_dir}/research/*.md` worth injecting. You may skip only if the jsonl already has agent-curated entries (the seed `_example` row alone doesn't count).
Then run `task.py start <task-dir>` to flip status to in_progress.
[/workflow-state:planning-ultra]

### Phase 2: Execute
- 2.1 Implement `[required · repeatable]`
- 2.2 Quality check `[required · repeatable]`
- 2.3 Rollback `[on demand]`

<!-- Per-turn breadcrumb: shown while status='in_progress'.
     Scope: all of Phase 2 + Phase 3.1-3.4 (status stays 'in_progress' from
     task.py start until task.py archive; only archive flips it). The body
     therefore must cover every required step from implementation through
     commit, including Phase 3.3 spec update and Phase 3.4 commit. -->

[workflow-state:in_progress]
**Tools**: `trellis-implement` / `trellis-research` are sub-agent types only (Task/Agent tool, NOT Skill — there is no skill by these names). `trellis-update-spec` is a skill. `trellis-check` exists as both; prefer the Agent form when verifying after code changes.
**Flow**: trellis-implement → trellis-check → trellis-update-spec → commit (Phase 3.4) → `/trellis:finish-work`.
**Main-session default (no override)**: dispatch the `trellis-implement` / `trellis-check` sub-agents — the main agent does NOT edit code by default. Phase 3.4 commit (required, once): after trellis-update-spec, or whenever implementation is verifiably complete, the main agent **drives the commit** — state the commit plan in user-facing text, then run `git commit` — BEFORE suggesting `/trellis:finish-work`. `/finish-work` refuses to run on a dirty working tree (paths outside `.trellis/workspace/` and `.trellis/tasks/`).
**Sub-agent self-exemption**: if you are already running as `trellis-implement`, implement directly from the loaded task context and do NOT spawn another `trellis-implement`; if you are already running as `trellis-check`, review/fix directly and do NOT spawn another `trellis-check`. The default dispatch rule applies to the main session only.
**Sub-agent dispatch protocol (all platforms, all sub-agents)**: When you spawn `trellis-implement` / `trellis-check` / `trellis-research`, your dispatch prompt **MUST** start with one line: `Active task: <task path from \`task.py current\`>`. No exceptions. On class-2 platforms (codex / copilot / gemini / qoder) the sub-agent depends on this line because there is no hook to inject task context. On class-1 platforms (claude / cursor / opencode / kiro / codebuddy / droid) the line is normally redundant — the hook injects context directly — but it serves as a critical fallback when the hook fails (Windows + Claude Code PreToolUse silent skip, `--continue` resume, fork distribution, hooks disabled, etc.). For `trellis-research`, the line tells the sub-agent which `{task_dir}/research/` to write into.
**Inline override** (per-turn only, escape hatch for sub-agent dispatch): the user's CURRENT message MUST explicitly contain one of: "do it inline" / "no sub-agent" / "你直接改" / "别派 sub-agent" / "main session 写就行" / "不用 sub-agent". **Without seeing one of these phrases you must NOT inline on your own**; do not invent an override the user never said.
**Ultracode**: if this turn shows an "Ultracode is on" system-reminder (single-turn ultracode without `ultracode.enabled` in config), switch to fan-out per the "Trellis × Ultracode" section — check fans out across review dimensions via the Workflow tool, implement stays single unless decomposable, and the Phase 3.4 commit stays main-driven. This overrides the single-dispatch default above for this turn only.
[/workflow-state:in_progress]

<!-- Per-turn breadcrumb: shown while status='in_progress' when
     codex.dispatch_mode=inline. Codex-only opt-in alternate to
     [workflow-state:in_progress]. The main session edits code directly
     instead of dispatching sub-agents. -->

[workflow-state:in_progress-inline]
**Flow** (inline mode): main session loads `trellis-before-dev` → main session edits code → main session loads `trellis-check` → run lint / type-check / tests → fix → `trellis-update-spec` → commit (Phase 3.4) → `/trellis:finish-work`.
**Main-session default (inline dispatch_mode)**: the main agent edits code directly. Do NOT dispatch `trellis-implement` / `trellis-check` sub-agents. Load the `trellis-before-dev` skill before writing code; load the `trellis-check` skill before reporting completion.
Phase 3.4 commit (required, once): after `trellis-update-spec`, or whenever implementation is verifiably complete, the main agent **drives the commit** — state the commit plan in user-facing text, then run `git commit` — BEFORE suggesting `/trellis:finish-work`. `/finish-work` refuses to run on a dirty working tree (paths outside `.trellis/workspace/` and `.trellis/tasks/`).
[/workflow-state:in_progress-inline]

<!-- Per-turn breadcrumb: shown while status='in_progress' when ultracode is on
     (config ultracode.enabled, class-1 platforms). Ultracode fan-out variant
     of [workflow-state:in_progress]: check fans out across review dimensions via
     the Workflow tool; implement stays single by default. Covers the same
     required steps as the base block — Phase 3.4 commit stays main-driven
     (regression invariant). Codex never reaches this variant (see
     resolve_breadcrumb_key). -->

[workflow-state:in_progress-ultra]
**Tools**: `trellis-implement` / `trellis-research` are sub-agent types only — dispatch them via the Task/Agent tool OR a Workflow `agent()` call (NOT Skill). `trellis-update-spec` is a skill. `trellis-check` exists as both; prefer the Agent / Workflow form when verifying after code changes.
**Flow**: implement → check → trellis-update-spec → commit (Phase 3.4) → `/trellis:finish-work`.
**Sub-agent self-exemption**: if you are already running as `trellis-implement` / `trellis-check` (a Task/Agent or Workflow `agent()` worker), implement or review/fix directly and do NOT spawn or fan out another Trellis sub-agent. The check fan-out and implement dispatch below are the main session's default only.
**Ultracode is on — check fans out (main-session default)**: instead of one `trellis-check` sub-agent, drive a Workflow pipeline that dispatches MULTIPLE `trellis-check` agents in parallel — one per review dimension (spec compliance / cross-layer data flow / security & resource safety / adversarial edge-case verification) — then the main session reconciles their findings and decides what to fix. See the "Trellis × Ultracode" section for the check pipeline template. If the Workflow tool is unavailable, fall back to several sequential `trellis-check` dispatches.
**Implement stays single by default**: dispatch ONE `trellis-implement` sub-agent as usual. Only when the prd decomposes into independent, non-overlapping units may you fan out implement across a Workflow pipeline with per-unit worktree isolation (experimental — requires the task dir already committed; see the Trellis × Ultracode section).
**Workflow agent context (no hook injection)**: a Workflow `agent()` call does NOT trigger the context-injection hook, so there is no `<!-- trellis-hook-injected -->` marker — each agent self-loads prd + jsonl spec via its "Trellis Context Loading Protocol". Every dispatch prompt MUST start with `Active task: <task path from \`task.py current\`>`, passed RELATIVE to repo root. **Check fan-out runs at repo root, NOT in a worktree** so the agent's cwd resolves the repo-root-relative jsonl paths.
**Workflow agents NEVER commit**: `trellis-implement` / `trellis-check` are forbidden from `git commit` / `push` / `merge` — fan-out does not relax this.
**Phase 3.4 commit (required, once)**: after the fan-out check reconciles green and `trellis-update-spec` runs, the MAIN session — not any Workflow agent — **drives the commit**: state the commit plan in user-facing text, then run `git commit`, BEFORE suggesting `/trellis:finish-work`. If implement fan-out used worktrees, merge those worktree branches back into the task branch FIRST so the main working tree is clean. `/finish-work` refuses to run on a dirty working tree (paths outside `.trellis/workspace/` and `.trellis/tasks/`).
**Inline override** (per-turn only): if the user's CURRENT message contains "do it inline" / "no sub-agent" / "你直接改" / "别派 sub-agent" / "main session 写就行" / "不用 sub-agent", drop fan-out and edit directly this turn.
[/workflow-state:in_progress-ultra]

### Phase 3: Finish
- 3.1 Quality verification `[required · repeatable]`
- 3.2 Debug retrospective `[on demand]`
- 3.3 Spec update `[required · once]`
- 3.4 Commit changes `[required · once]`
- 3.5 Wrap-up reminder

<!-- Per-turn breadcrumb: shown while status='completed'.
     Currently DEAD in normal flow: cmd_archive writes status='completed' in
     the same call that moves the task dir to archive/, so the active-task
     resolver loses the pointer and the hook never fires on archived tasks.
     Block preserved for a future status-transition redesign (e.g. an
     explicit in_progress→completed command). Edit through the same spec
     channel as the live blocks. -->

[workflow-state:completed]
Code committed via Phase 3.4; run `/trellis:finish-work` to wrap up (archive the task + record session).
If you reach this state with uncommitted code, return to Phase 3.4 first — `/finish-work` refuses to run on a dirty working tree.
`task.py archive` deletes any runtime session files that still point at the archived task.
[/workflow-state:completed]

### Rules

1. Identify which Phase you're in, then continue from the next step there
2. Run steps in order inside each Phase; `[required]` steps can't be skipped
3. Phases can roll back (e.g., Execute reveals a prd defect → return to Plan to fix, then re-enter Execute)
4. Steps tagged `[once]` are skipped if the output already exists; don't re-run

### Skill Routing

When a user request matches one of these intents, load the corresponding skill (or dispatch the corresponding sub-agent) first — do not skip skills.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

| User intent | Route |
|---|---|
| Wants a new feature / requirement unclear | `trellis-brainstorm` |
| About to write code / start implementing | Dispatch the `trellis-implement` sub-agent per Phase 2.1 |
| Finished writing / want to verify | Dispatch the `trellis-check` sub-agent per Phase 2.2 |
| Stuck / fixed same bug several times | `trellis-break-loop` |
| Spec needs update | `trellis-update-spec` |

**Why `trellis-before-dev` is NOT in this table:** you are not the one writing code — the `trellis-implement` sub-agent is. Sub-agent platforms get spec context via `implement.jsonl` injection / prelude, not via the main thread loading `trellis-before-dev`.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

| User intent | Skill |
|---|---|
| Wants a new feature / requirement unclear | `trellis-brainstorm` |
| About to write code / start implementing | `trellis-before-dev` (then implement directly in the main session) |
| Finished writing / want to verify | `trellis-check` |
| Stuck / fixed same bug several times | `trellis-break-loop` |
| Spec needs update | `trellis-update-spec` |

[/codex-inline, Kilo, Antigravity, Windsurf]

### DO NOT skip skills

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

| What you're thinking | Why it's wrong |
|---|---|
| "This is simple, I'll just code it in the main thread" | Dispatching `trellis-implement` is the cheap path; skipping it tempts you to write code in the main thread and lose spec context — sub-agents get `implement.jsonl` injected, you don't |
| "I already thought it through in plan mode" | Plan-mode output lives in memory — sub-agents can't see it; must be persisted to prd.md |
| "I already know the spec" | The spec may have been updated since you last read it; the sub-agent gets the fresh copy, you may not |
| "Code first, check later" | `trellis-check` surfaces issues you won't notice yourself; earlier is cheaper |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

| What you're thinking | Why it's wrong |
|---|---|
| "This is simple, just code it" | Simple tasks often grow complex; `trellis-before-dev` takes under a minute and loads the spec context you'll need |
| "I already thought it through in plan mode" | Plan-mode output lives in memory — must be persisted to prd.md before code |
| "I already know the spec" | The spec may have been updated since you last read it; read again |
| "Code first, check later" | `trellis-check` surfaces issues you won't notice yourself; earlier is cheaper |

[/codex-inline, Kilo, Antigravity, Windsurf]

### Loading Step Detail

At each step, run this to fetch detailed guidance:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <step>
# e.g. python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

---

## Phase 1: Plan

Goal: figure out what to build, produce a clear requirements doc and the context needed to implement it.

#### 1.0 Create task `[required · once]`

Create the task directory (status enters `planning`, the session active-task pointer auto-targets the new task when session identity is available):

```bash
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name>
```

`--slug` is the human-readable name only. Do **not** include the `MM-DD-` date prefix; `task.py create` adds that prefix automatically.

After this command succeeds, the per-turn breadcrumb auto-switches to `[workflow-state:planning]`, telling the AI to enter the brainstorm + jsonl curation phase.

⚠️ **Run only `create` here — do not also run `start`**. `start` flips status to `in_progress`, which switches the breadcrumb to the implementation phase before brainstorm + jsonl are done — the AI will silently skip them. Save `start` for step 1.4, after jsonl curation is complete.

Skip when `python3 ./.trellis/scripts/task.py current --source` already points to a task.

#### 1.1 Requirement exploration `[required · repeatable]`

Load the `trellis-brainstorm` skill and explore requirements interactively with the user per the skill's guidance.

The brainstorm skill will guide you to:
- Ask one question at a time
- Prefer researching over asking the user
- Prefer offering options over open-ended questions
- Update `prd.md` immediately after each user answer

Return to this step whenever requirements change and revise `prd.md`.

#### 1.2 Research `[optional · repeatable]`

Research can happen at any time during requirement exploration. It isn't limited to local code — you can use any available tool (MCP servers, skills, web search, etc.) to look up external information, including third-party library docs, industry practices, API references, etc.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

Spawn the research sub-agent:

- **Agent type**: `trellis-research`
- **Task description**: Research <specific question>
- **Key requirement**: Research output MUST be persisted to `{TASK_DIR}/research/`

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

Do the research in the main session directly and write findings into `{TASK_DIR}/research/`. (For `codex-inline` this avoids the `fork_turns="none"` isolation that prevents `trellis-research` sub-agents from resolving the active task path.)

[/codex-inline, Kilo, Antigravity, Windsurf]

**Research artifact conventions**:
- One file per research topic (e.g. `research/auth-library-comparison.md`)
- Record third-party library usage examples, API references, version constraints in files
- Note relevant spec file paths you discovered for later reference

Brainstorm and research can interleave freely — pause to research a technical question, then return to talk with the user.

**Key principle**: Research output must be written to files, not left only in the chat. Conversations get compacted; files don't.

#### 1.3 Configure context `[required · once]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

Curate `implement.jsonl` and `check.jsonl` so the Phase 2 sub-agents get the right spec context. These files were seeded on `task create` with a single self-describing `_example` line; your job here is to fill in real entries.

**Location**: `{TASK_DIR}/implement.jsonl` and `{TASK_DIR}/check.jsonl` (already exist).

**Format**: one JSON object per line — `{"file": "<path>", "reason": "<why>"}`. Paths are repo-root relative.

**What to put in**:
- **Spec files** — `.trellis/spec/<package>/<layer>/index.md` and any specific guideline files (`error-handling.md`, `conventions.md`, etc.) relevant to this task
- **Research files** — `{TASK_DIR}/research/*.md` that the sub-agent will need to consult

**What NOT to put in**:
- Code files (`src/**`, `packages/**/*.ts`, etc.) — those are read by the sub-agent during implementation, not pre-registered here
- Files you're about to modify — same reason

**Split between the two files**:
- `implement.jsonl` → specs + research the implement sub-agent needs to write code correctly
- `check.jsonl` → specs for the check sub-agent (quality guidelines, check conventions, same research if needed)

**How to discover relevant specs**:

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

Lists every package + its spec layers with paths. Pick the entries that match this task's domain.

**How to append entries**:

Either edit the jsonl file directly in your editor, or use:

```bash
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" implement "<path>" "<reason>"
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

Delete the seed `_example` line once real entries exist (optional — it's skipped automatically by consumers).

Skip when: `implement.jsonl` has agent-curated entries (the seed row alone doesn't count).

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

Skip this step. Context is loaded directly by the `trellis-before-dev` skill in Phase 2.

[/codex-inline, Kilo, Antigravity, Windsurf]

#### 1.4 Activate task `[required · once]`

Once prd.md is complete and 1.3 jsonl curation is done, flip the task status to `in_progress`:

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

After this command succeeds, the breadcrumb auto-switches to `[workflow-state:in_progress]`, and the rest of Phase 2 / 3 follows.

If `task.py start` errors with a session-identity message (no context key from hook input, `TRELLIS_CONTEXT_ID`, or platform-native session env), follow the hint in the error to set up session identity, then retry.

#### 1.5 Completion criteria

| Condition | Required |
|------|:---:|
| `prd.md` exists | ✅ |
| User confirms requirements | ✅ |
| `task.py start` has been run (status = in_progress) | ✅ |
| `research/` has artifacts (complex tasks) | recommended |
| `info.md` technical design (complex tasks) | optional |

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

| `implement.jsonl` has agent-curated entries (not just the seed row) | ✅ |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

---

## Phase 2: Execute

Goal: turn the prd into code that passes quality checks.

#### 2.1 Implement `[required · repeatable]`

[Claude Code, Cursor, OpenCode, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the requirements per prd.md, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

The platform hook/plugin auto-handles:
- Reads `implement.jsonl` and injects the referenced spec files into the agent prompt
- Injects prd.md content

[/Claude Code, Cursor, OpenCode, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-sub-agent]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the requirements per prd.md, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then explicitly say the spawned agent is already `trellis-implement` and must implement directly without spawning another `trellis-implement` / `trellis-check`.

The Codex sub-agent definition auto-handles the context load requirement:
- Resolves the active task with `task.py current --source`, then reads `prd.md` and `info.md` if present
- Reads `implement.jsonl` and requires the agent to load each referenced spec file before coding

[/codex-sub-agent]

[Kiro]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the requirements per prd.md, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

The platform prelude auto-handles the context load requirement:
- Reads `implement.jsonl` and injects the referenced spec files into the agent prompt
- Injects prd.md content

[/Kiro]

[codex-inline, Kilo, Antigravity, Windsurf]

1. Load the `trellis-before-dev` skill to read project guidelines
2. Read `{TASK_DIR}/prd.md` for requirements
3. Consult materials under `{TASK_DIR}/research/`
4. Implement the code per requirements
5. Run project lint and type-check

[/codex-inline, Kilo, Antigravity, Windsurf]

#### 2.2 Quality check `[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

Spawn the check sub-agent:

- **Agent type**: `trellis-check`
- **Task description**: Review all code changes against spec and prd; fix any findings directly; ensure lint and type-check pass
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-check` sub-agent and must review/fix directly, not spawn another `trellis-check` / `trellis-implement`.

The check agent's job:
- Review code changes against specs
- Auto-fix issues it finds
- Run lint and typecheck to verify

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi]

[codex-inline, Kilo, Antigravity, Windsurf]

Load the `trellis-check` skill and verify the code per its guidance:
- Spec compliance
- lint / type-check / tests
- Cross-layer consistency (when changes span layers)

If issues are found → fix → re-check, until green.

[/codex-inline, Kilo, Antigravity, Windsurf]

#### 2.3 Rollback `[on demand]`

- `check` reveals a prd defect → return to Phase 1, fix `prd.md`, then redo 2.1
- Implementation went wrong → revert code, redo 2.1
- Need more research → research (same as Phase 1.2), write findings into `research/`

---

## Phase 3: Finish

Goal: ensure code quality, capture lessons, record the work.

#### 3.1 Quality verification `[required · repeatable]`

Load the `trellis-check` skill and do a final verification:
- Spec compliance
- lint / type-check / tests
- Cross-layer consistency (when changes span layers)

If issues are found → fix → re-check, until green.

#### 3.2 Debug retrospective `[on demand]`

If this task involved repeated debugging (the same issue was fixed multiple times), load the `trellis-break-loop` skill to:
- Classify the root cause
- Explain why earlier fixes failed
- Propose prevention

The goal is to capture debugging lessons so the same class of issue doesn't recur.

#### 3.3 Spec update `[required · once]`

Load the `trellis-update-spec` skill and review whether this task produced new knowledge worth recording:
- Newly discovered patterns or conventions
- Pitfalls you hit
- New technical decisions

Update the docs under `.trellis/spec/` accordingly. Even if the conclusion is "nothing to update", walk through the judgment.

#### 3.4 Commit changes `[required · once]`

The AI drives a batched commit of this task's code changes so `/finish-work` can run cleanly afterwards. Goal: produce work commits FIRST, then bookkeeping (archive + journal) commits land after — never interleaved.

**Step-by-step**:

1. **Inspect dirty state**:
   ```bash
   git status --porcelain
   ```
   Snapshot every dirty path. If the working tree is clean, skip to 3.5.

2. **Learn commit style** from recent history (so drafted messages blend in):
   ```bash
   git log --oneline -5
   ```
   Note the prefix convention (`feat:` / `fix:` / `chore:` / `docs:` ...), language (中文/English), and length style.

3. **Classify dirty files into two groups**:
   - **AI-edited this session** — files you wrote/edited via Edit/Write/Bash tool calls in this session. You know what changed and why.
   - **Unrecognized** — dirty files you did NOT touch this session (could be the user's manual edits, leftover WIP from a previous session, or unrelated work). Do NOT silently include these.

4. **Draft a commit plan**. Group AI-edited files into logical commits (1 commit per coherent change unit, not 1 commit per file). Each entry: `<commit message>` + file list. List unrecognized files separately at the bottom.

5. **Present the plan once, ask for one-shot confirmation**. Format:
   ```
   Proposed commits (in order):
     1. <message>
        - <file>
        - <file>
     2. <message>
        - <file>

   Unrecognized dirty files (NOT in any commit — confirm include/exclude):
     - <file>
     - <file>

   Reply 'ok' / '行' to execute. Reply with edits, or '我自己来' / 'manual' to abort.
   ```

6. **On confirmation**: run `git add <files>` + `git commit -m "<msg>"` for each batch in order. Do not amend. Do not push.

7. **On rejection** (user replies "不行" / "我自己来" / "manual" / any pushback on the plan): stop. Do not attempt a second plan. The user will commit by hand; you skip ahead to 3.5 once they confirm.

**Rules**:
- No `git commit --amend` anywhere — three-stage three-commit flow (work commits → archive commit → journal commit).
- Never push to remote in this step.
- If the user wants different message wording but accepts the file grouping, edit the message and re-confirm once — but if they reject the grouping, exit to manual mode.
- The batched plan is one prompt; do not prompt per commit.

#### 3.5 Wrap-up reminder

After the above, remind the user they can run `/finish-work` to wrap up (archive the task, record the session).

---

## Trellis × Ultracode

"Ultracode" is Claude Code's Workflow tool — large-scale parallel agent orchestration. This section is the protocol the `*-ultra` breadcrumbs point to. It lets Trellis fan out research/check across many agents while keeping every Trellis discipline (spec/jsonl context, prd-driven work, commit ownership).

### When it activates

Two channels, either one:

1. **Config-persistent** — `.trellis/config.yaml` sets `ultracode.enabled: true`. `inject-workflow-state.py`'s `resolve_breadcrumb_key` then serves the `planning-ultra` / `in_progress-ultra` breadcrumbs (class-1 platforms only — `claude` / `cursor` / `opencode` / `kiro` / `codebuddy` / `droid`).
2. **Single-turn** — the turn shows an "Ultracode is on" system-reminder even though config is off. The base `planning` / `in_progress` breadcrumbs carry an `**Ultracode**:` fallback line telling you to switch to this protocol for that turn only.

Codex never activates ultracode — its `fork_turns="none"` sub-agent isolation can't fan out, and `resolve_breadcrumb_key` returns in the codex branch first. If the Workflow tool isn't available on your platform, degrade gracefully to several sequential Task/Agent dispatches.

### What fans out

| Phase | Default under ultracode | Notes |
|---|---|---|
| 1.2 Research | **fan-out** | One `trellis-research` agent per independent angle, in parallel. Each writes its own `{task_dir}/research/*.md`. |
| 2.1 Implement | **single** (default) | Dispatch ONE `trellis-implement`. Fan out only when the prd splits into independent, non-overlapping units (experimental — see Worktree below). |
| 2.2 / 3.1 Check | **fan-out** | Multiple `trellis-check` agents, one per review dimension; the main session reconciles. |
| 3.4 Commit | **main session only** | Never a Workflow agent. Identical to the base flow. |

The discipline is unchanged — fan-out only multiplies *executors*. The prd still drives, the jsonl still defines context, and the main session still owns the commit.

### How a Workflow agent inherits Trellis context

A Workflow `agent()` call does NOT go through the PreToolUse context-injection hook, so the agent receives no `<!-- trellis-hook-injected -->` marker. That is fine: the `trellis-implement` / `trellis-check` / `trellis-research` agent definitions all carry a "Context Loading Protocol" fallback for exactly this case — when the marker is absent, the agent reads `prd.md` + the `*.jsonl` spec files itself from the active task path. (This fallback was written for hook failures — Windows, `--continue` resume, fork distribution — and the Workflow path is just another "no marker" case.)

So every Workflow dispatch prompt MUST start with:

```
Active task: <task path from `task.py current`>
```

passed RELATIVE to repo root. The agent resolves prd/jsonl against its own cwd, which is why **check / research fan-out must run at repo root, not in a worktree** — a worktree cwd may not contain the (possibly uncommitted) task dir.

### Check pipeline template

A minimal `in_progress-ultra` check fan-out. The Workflow JS parser rejects nested template literals and full-width quotes — use plain string concatenation and half-width quotes only.

```javascript
// trellis-check fan-out: parallel review dimensions, main session reconciles.
// <TASK> = repo-root-relative task dir, substituted by the main session.
const TASK = ".trellis/tasks/06-08-example";
const ACTIVE = "Active task: " + TASK + "\n\n";
const dims = [
  { n: "spec",        body: "dimension SPEC COMPLIANCE only. Read " + TASK + "/prd.md and every spec in " + TASK + "/check.jsonl, then git diff and verify the change follows them. Fix directly. No git commit/push/merge. No re-spawn." },
  { n: "cross-layer", body: "dimension CROSS-LAYER DATA FLOW only. Load " + TASK + "/prd.md + check.jsonl specs. Trace changed data across layers; flag type/contract/validation breaks. Fix directly. No git commit. No re-spawn." },
  { n: "security",    body: "dimension SECURITY and RESOURCE SAFETY only. Load " + TASK + "/prd.md. Check authz, injection, leaked secrets, unbounded loops, leaks, money-path correctness. Fix directly. No git commit. No re-spawn." },
  { n: "adversarial", body: "dimension ADVERSARIAL VERIFICATION only. Load " + TASK + "/prd.md. Assume the diff is wrong; build concrete failing/edge inputs and prove pass/fail. REPORT only, do not silent-fix (main reconciles). No git commit. No re-spawn." },
];
const outs = [];
for (const d of dims) {
  outs.push(agent(ACTIVE + "You are trellis-check, " + d.body, { agentType: "trellis-check" }));
}
const results = [];
for (let i = 0; i < dims.length; i++) results.push("### " + dims[i].n + "\n" + (await outs[i]));
return results.join("\n\n");
// main session: merge findings -> fix or dispatch a single trellis-implement ->
// converge green -> Phase 3.4 commit (main-driven).
```

The first three dimensions may fix non-overlapping concerns directly; the adversarial dimension reports only, so concurrent agents never write the same file. If write conflicts are still a concern, make all dimensions report-only and let the main session apply fixes serially.

### Implement worktree fan-out (experimental)

Only when the prd decomposes into independent units. Preconditions: the task dir is **already committed** (so each worktree, cut from a commit, contains `prd.md` + jsonl); each unit gets its own worktree via `isolation: "worktree"`. Agents write but do NOT commit; the main session merges the worktree branches back into the task branch BEFORE the Phase 3.4 commit, so the main working tree is clean for `/trellis:finish-work`. Keep this off unless the user asks for it — most implement work is a single coherent change that should not be force-split.

---

## Customizing Trellis (for forks)

This section is for developers who want to modify the Trellis workflow itself. All customization is done by editing this file; the scripts are parsers only.

### Changing what a step means

Edit the corresponding step's walkthrough body in the Phase 1 / 2 / 3 sections above. **Critical constraint**: if you change a step's `[required · once]` marker or add a new `[required · once]` step, you MUST also add a matching enforcement line to that phase's base `[workflow-state:STATUS]` tag block **and to each of its active dispatch-mode variants** (`-inline` for codex, `-ultra` for ultracode) — otherwise the per-turn breadcrumb omits the reinforcement on whichever path is served, and the AI silently skips the step. The regression tests assert this for the base and `-ultra` blocks.

There are 8 tag blocks in the `## Phase Index` section above — 4 base blocks plus 4 dispatch-mode variants that `resolve_breadcrumb_key` selects per platform/config (see the **DISPATCH-MODE VARIANTS** note near the top of this file). Only `planning` / `in_progress` have variants; `no_task` / `completed` do not (a missing `*-ultra` / `*-inline` tag falls back to the base via `build_breadcrumb`):

| Scope | Base tag | Active variants |
|---|---|---|
| No active task (before Phase 1) | `[workflow-state:no_task]` | — |
| All of Phase 1 (task created → ready for implementation) | `[workflow-state:planning]` | `planning-inline` (codex), `planning-ultra` (ultracode) |
| Phase 2 + Phase 3.1–3.4 (implementation + check + wrap-up) | `[workflow-state:in_progress]` | `in_progress-inline` (codex), `in_progress-ultra` (ultracode) |
| After Phase 3.5 (archived) | `[workflow-state:completed]` (**currently DEAD**) | — |

### Changing the per-turn prompt text

Directly edit the body of the corresponding `[workflow-state:STATUS]` block. After editing, run `trellis update` (if you're a template maintainer) or restart your AI session (if you're customizing your own project) — no script changes required.

### Adding a custom status

Add a new block:

```
[workflow-state:my-status]
your per-turn prompt text
[/workflow-state:my-status]
```

Constraints:
- STATUS charset: `[A-Za-z0-9_-]+` (underscores and hyphens allowed, e.g. `in-review`, `blocked-by-team`)
- A lifecycle hook must write `task.json.status` to your custom value, otherwise the tag is never read
- Lifecycle hooks live in `task.json.hooks.after_*` and bind to one of `after_create / after_start / after_finish / after_archive`

### Adding a lifecycle hook

Add a `hooks` field to your `task.json`:

```json
{
  "hooks": {
    "after_finish": [
      "your-script-or-command-here"
    ]
  }
}
```

Supported events: `after_create / after_start / after_finish / after_archive`. Note that `after_finish` ≠ a status change (it only clears the active-task pointer); use `after_archive` for "task is done" notifications.

### Full contract

For the workflow state machine's runtime contract, the locations of all status writers, pseudo-statuses (`no_task` / `stale_<source_type>`), the hook reachability matrix, and other deep details, see:

- `.trellis/spec/cli/backend/workflow-state-contract.md` — runtime contract + writer table + test invariants
- `.trellis/scripts/inject-workflow-state.py` — actual parser (reads workflow.md only, no embedded text)
