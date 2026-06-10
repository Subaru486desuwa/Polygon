# Development Workflow

---

## Core Principles

1. **Plan before code** — figure out what to do before you start
2. **Persist everything** — research, decisions, and lessons go to files; conversations get compacted, files don't
3. **Incremental development** — one task at a time
4. **Capture learnings** — write new knowledge back to `.trellis/spec/` when a task produces any

---

## Trellis System

### Developer Identity

On first use: `python3 ./.trellis/scripts/init_developer.py <your-name>` — creates `.trellis/.developer` (gitignored) + `.trellis/workspace/<your-name>/`.

### Spec System

`.trellis/spec/` holds coding guidelines. Start from `.trellis/spec/<package>/<layer>/index.md` and `.trellis/spec/guides/index.md`; update when a new pattern, pitfall, or technical decision is worth keeping.

### Task System

Every task lives under `.trellis/tasks/{MM-DD-name}/` with `prd.md`, `task.json`, optional `research/`, `info.md` (plus `implement.jsonl` / `check.jsonl` seeds used only for sub-agent dispatch).

```bash
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>]   # status=planning
python3 ./.trellis/scripts/task.py start <name>          # status=in_progress, sets active pointer
python3 ./.trellis/scripts/task.py current --source      # show active task
python3 ./.trellis/scripts/task.py finish                # clear active pointer
python3 ./.trellis/scripts/task.py archive <name>        # move to archive/{year-month}/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

> `task.py --help` has the authoritative list. Session pointers live under `.trellis/.runtime/sessions/`.

### Activity Log (multi-LLM)

Per-task `activity.jsonl` — append-only record of *which LLM (platform/model) did what, when*, for cross-LLM handoff: an agent picking up a task reads what a prior agent already did and decided, without sharing a conversation.

```bash
python3 ./.trellis/scripts/task.py activity-append [<name>] --action <verb> [--note "<text>"]
python3 ./.trellis/scripts/task.py activity-log [<name>]    # readable timeline
```

- **Auto-stamped** on phase transitions — `start`/`archive` write entries; journal and `task.json` `meta.agents[]` record the acting platform/model.
- **Manual milestones** — stamp `decision` / `handoff` at points worth preserving for the next agent.
- **Resolution** — `platform` auto-derives from `TRELLIS_CONTEXT_ID`; `model` is best-effort (pass `--model` or set `TRELLIS_ACTIVITY_MODEL`, else null).

[codex-sub-agent, codex-inline]
**Codex handoff protocol** (hooks don't auto-stamp Codex — be explicit):
1. On pickup: `task.py activity-log <name>`, then read `prd.md` + `research/`.
2. On each meaningful step: `task.py activity-append <name> --platform codex --action <verb> --note "<what>"`.
3. On commit: add the trailer `Co-Authored-By: Codex <noreply@openai.com>`.
[/codex-sub-agent, codex-inline]

**Claude dispatching Codex**: when a Codex job returns, write its output into the task dir, stamp `activity-append <name> --platform codex --action <verb> --note "via codex:rescue"` on its behalf (ambient session id auto-drops for cross-platform stamps; pass `--session <codex-job-id>` if known), and add the `Co-Authored-By: Codex` trailer.

### Workspace System

Session records under `.trellis/workspace/<developer>/journal-N.md` (auto-rotates at 2000 lines):

```bash
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "hash" --summary "Summary"
```

### Context Script

```bash
python3 ./.trellis/scripts/get_context.py                            # full session runtime
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>  # detailed guide for a workflow step
```

---

<!--
  BREADCRUMB CONTRACT: the [workflow-state:STATUS] blocks below are the single
  source of truth for the per-turn <workflow-state> breadcrumb parsed by the
  platform UserPromptSubmit hooks (e.g. .claude/hooks/inject-workflow-state.py,
  .codex/hooks/inject-workflow-state.py).
  STATUS charset [A-Za-z0-9_-]+. Variants: <status>-inline (codex
  dispatch_mode=inline), <status>-ultra (config ultracode.enabled, claude).
  Missing variant tags fall back to the base status; a missing base tag
  degrades to a visible generic line. Keep tag pairs matched.
-->

## Phase Index

```
Phase 1: Plan    → figure out what to do (brainstorm + research → prd.md)
Phase 2: Execute → write code and pass quality checks
Phase 3: Finish  → distill lessons + wrap-up
```

[workflow-state:no_task]
No active task. Judge the turn's real size yourself:
- Multi-turn implementation work, or anything worth a persistent record → `python3 ./.trellis/scripts/task.py create "<title>"`, brainstorm into prd.md, then `task.py start <task-dir>`.
- Questions, quick fixes, one-shot edits → answer or do them inline; no task ceremony. If an inline change grows beyond expectations, create the task at that point.
[/workflow-state:no_task]

### Phase 1: Plan
- 1.1 Requirement exploration → prd.md
- 1.2 Research `[as needed]` → `{task_dir}/research/*.md`
- 1.3 Configure jsonl context `[sub-agent dispatch only]`
- 1.4 Activate task (`task.py start`)

[workflow-state:planning]
Iterate on prd.md with the user (the `trellis-brainstorm` skill has the template); persist research to `{task_dir}/research/` — files survive compaction, chat doesn't.
Phase 1.3 (only if Phase 2 will dispatch sub-agents): curate `implement.jsonl` / `check.jsonl` so sub-agents get spec context injected. Working inline (the default)? Skip it.
When the prd is settled, run `task.py start <task-dir>`.
**Ultracode**: if this turn shows an "Ultracode is on" system-reminder, research may fan out per the "Trellis × Ultracode" section.
[/workflow-state:planning]

[workflow-state:planning-inline]
Iterate on prd.md with the user; persist research to `{task_dir}/research/`. jsonl curation is skipped in inline mode.
When the prd is settled, run `task.py start <task-dir>`.
[/workflow-state:planning-inline]

[workflow-state:planning-ultra]
Iterate on prd.md with the user. Ultracode is on: when research splits into independent angles, fan out parallel `trellis-research` agents via the Workflow tool, each dispatch prompt starting with `Active task: <task path from \`task.py current\`>`; trivial planning turns need no fan-out.
Phase 1.3 (only if Phase 2 will dispatch sub-agents): curate `implement.jsonl` / `check.jsonl` after the parallel research lands. Working inline? Skip it.
When the prd is settled, run `task.py start <task-dir>`.
[/workflow-state:planning-ultra]

### Phase 2: Execute
- 2.1 Implement (main session by default)
- 2.2 Verify (lint / type-check / tests)

[workflow-state:in_progress]
Implement in the main session by default — you hold the full conversation context. Read `{task_dir}/prd.md` + `research/` and the relevant `.trellis/spec/` guides before coding; run lint / type-check / tests before reporting done.
Sub-agents (`trellis-implement` / `trellis-check` / `trellis-research` via the Task/Agent tool; `trellis-check` and `trellis-update-spec` also exist as skills) are optional tools for parallelizable or context-heavy chunks — not a required pipeline. **Sub-agent dispatch protocol (all platforms, all sub-agents)**: the dispatch prompt MUST start with `Active task: <task path from \`task.py current\`>` — for `trellis-research` this resolves which `{task_dir}/research/` to write into. Sub-agents never run git commit/push/merge; if you ARE one, work directly — don't spawn another.
Then commit (Phase 3.4): the main session states the commit plan, lists unrecognized dirty files for the user to include/exclude (never silently commit them), runs `git commit` — no `--amend`, no push. Wrap up with `/trellis:finish-work` (it refuses to run on a dirty working tree).
**Ultracode**: if this turn shows an "Ultracode is on" system-reminder, verification may fan out per the "Trellis × Ultracode" section; the commit stays main-driven.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Main session edits code directly (inline mode — no trellis-implement / trellis-check sub-agents). Read `{task_dir}/prd.md` + `research/` and relevant `.trellis/spec/` guides before coding; lint / type-check / tests before reporting done.
Then commit (Phase 3.4): state the commit plan, list unrecognized dirty files for the user to include/exclude, run `git commit` — no `--amend`, no push. Wrap up with `/trellis:finish-work` (it refuses to run on a dirty working tree).
[/workflow-state:in_progress-inline]

[workflow-state:in_progress-ultra]
**Trivial turn — answer directly, no fan-out**: pure Q&A / status checks / one-line fixes get a direct answer at full reasoning depth; fan-out is for substantive implement / verify work.
Ultracode is on: for real verification, fan out `trellis-check` agents via the Workflow tool — one per review dimension (see the "Trellis × Ultracode" section for the pipeline template) — and reconcile findings in the main session. Implement stays single by default; fan out `trellis-implement` only when the prd splits into independent, non-overlapping units (worktree isolation, experimental). Every dispatch prompt starts with `Active task: <task path from \`task.py current\`>`, repo-root relative; Workflow agents self-load prd + jsonl (no hook injection), and check fan-out runs at repo root, not in a worktree. Workflow agents never run `git commit` / `push` / `merge`.
**Sub-agent self-exemption**: if you are already a trellis-implement / trellis-check worker, do the work directly — no further fan-out.
After checks reconcile green, the MAIN session drives the commit (Phase 3.4) — commit plan in user-facing text, unrecognized dirty files confirmed with the user, `git commit`, no `--amend`, no push — then `/trellis:finish-work`. If implement fan-out used worktrees, merge them back into the task branch first.
[/workflow-state:in_progress-ultra]

### Phase 3: Finish
- 3.1 Final verification
- 3.2 Debug retrospective `[on demand]` (`trellis-break-loop`)
- 3.3 Spec update `[when new knowledge surfaced]`
- 3.4 Commit changes
- 3.5 `/trellis:finish-work`

[workflow-state:completed]
Code committed; run `/trellis:finish-work` to wrap up (archive the task + record session).
If you reach this state with uncommitted code, commit first (Phase 3.4) — `/finish-work` refuses to run on a dirty working tree.
[/workflow-state:completed]

### Skill Routing

These are the default routes when a request matches an intent; deviate when you have a concrete reason.

| User intent | Route |
|---|---|
| Wants a new feature / requirement unclear | `trellis-brainstorm` |
| About to write code / start implementing | `trellis-before-dev` (then implement directly in the main session) |
| Finished writing / want to verify | `trellis-check` |
| Stuck / fixed same bug several times | `trellis-break-loop` |
| Spec needs update | `trellis-update-spec` |

### Loading Step Detail

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <step>   # e.g. --step 1.1
```

---

## Phase 1: Plan

Goal: figure out what to build; produce a clear requirements doc and the context needed to implement it.

#### 1.1 Requirement exploration `[repeatable]`

Create the task if it doesn't exist (`task.py create "<task title>" --slug <name>` — no `MM-DD-` date prefix in the slug, it's added automatically), then iterate on `prd.md` with the user. Prefer researching over asking; prefer options over open-ended questions; update prd.md as answers land.

#### 1.2 Research `[as needed · repeatable]`

Research in the main session with any available tool (code search, web, MCP), or fan out `trellis-research` sub-agents for independent angles. Either way, findings go to `{task_dir}/research/<topic>.md` — one file per topic, with file:line citations and version constraints. Research left only in chat is lost on compaction.

#### 1.3 Configure jsonl context `[sub-agent dispatch only · once]`

Only needed when Phase 2 will dispatch `trellis-implement` / `trellis-check` sub-agents: curate `{task_dir}/implement.jsonl` and `check.jsonl` (one JSON object per line: `{"file": "<path>", "reason": "<why>"}`) with the spec + research files those agents need. Working inline — the default — skip this step.

#### 1.4 Activate task

```bash
python3 ./.trellis/scripts/task.py start <task-dir>    # status → in_progress
```

If `start` errors about session identity, follow the hint in the error, then retry.

---

## Phase 2: Execute

Goal: turn the prd into code that passes quality checks.

#### 2.1 Implement `[repeatable]`

Default: implement directly in the main session. Read `prd.md`, consult `research/`, load `trellis-before-dev` for spec context if the area is unfamiliar. Dispatch a `trellis-implement` sub-agent only when it genuinely helps (parallelizable chunk, context-heavy isolation); its prompt must start with `Active task: <task path>` and state that it must not spawn further sub-agents.

#### 2.2 Verify `[repeatable]`

Run project lint / type-check / tests. For substantive changes, load the `trellis-check` skill (or dispatch the `trellis-check` sub-agent) to review spec compliance and cross-layer consistency. Fix → re-check until green.

#### 2.3 Rollback `[on demand]`

Check reveals a prd defect → fix `prd.md`, redo 2.1. Implementation went wrong → revert, redo 2.1. Need more research → back to 1.2.

---

## Phase 3: Finish

Goal: ensure quality, capture lessons, record the work.

#### 3.1 Final verification `[repeatable]`

Same as 2.2, one last time across the whole change.

#### 3.2 Debug retrospective `[on demand]`

If the same issue was fixed multiple times this task, load `trellis-break-loop`: classify the root cause, explain why earlier fixes failed, capture prevention into spec.

#### 3.3 Spec update `[when new knowledge surfaced]`

If this task produced knowledge worth keeping — a new pattern or convention, a pitfall you hit, a technical decision — capture it under `.trellis/spec/` (the `trellis-update-spec` skill has the format). Nothing new? Move on; no judgment ceremony needed.

#### 3.4 Commit changes

The main session drives the commit so `/finish-work` can run cleanly afterwards (work commits first, bookkeeping commits after — never interleaved).

- `git status --porcelain` + `git log --oneline -5`: see what's dirty, match the repo's commit style. Clean tree → skip to 3.5.
- Group the files you edited this session into logical commits and state the plan in user-facing text. Dirty files you did NOT touch this session are listed for the user to include/exclude — **never silently committed**.
- Hard rules: no `git commit --amend`, never push in this step. If the user rejects the plan, let them commit by hand and continue to 3.5.

#### 3.5 Wrap-up

Remind the user they can run `/trellis:finish-work` (archives the task, records the session).

---

## Trellis × Ultracode

"Ultracode" is Claude Code's Workflow tool — large-scale parallel agent orchestration. This is the protocol the `*-ultra` breadcrumbs (and the single-turn "Ultracode is on" reminder) point to.

### When it activates

1. **Config-persistent** — `.trellis/config.yaml` sets `ultracode.enabled: true` → the hook serves `planning-ultra` / `in_progress-ultra` breadcrumbs (claude only).
2. **Single-turn** — the turn shows an "Ultracode is on" system-reminder; the base breadcrumbs carry an `**Ultracode**:` fallback line for that turn only.

Codex never activates ultracode (its `fork_turns="none"` sub-agent isolation can't fan out). No Workflow tool available → degrade to several sequential Task/Agent dispatches.

### What fans out

| Phase | Default | Notes |
|---|---|---|
| 1.2 Research | **fan-out** | One `trellis-research` agent per independent angle; each writes its own `{task_dir}/research/*.md`. |
| 2.1 Implement | **single** | Fan out only when the prd splits into independent, non-overlapping units (worktree isolation, experimental). |
| 2.2 / 3.1 Check | **fan-out** | One `trellis-check` agent per review dimension; main session reconciles. |
| 3.4 Commit | **main session only** | Never a Workflow agent. |

Fan-out only multiplies executors: the prd still drives, jsonl still defines sub-agent context, the main session still owns the commit.

### Workflow agent context

A Workflow `agent()` call does NOT trigger the context-injection hook — each agent self-loads `prd.md` + jsonl specs via its Context Loading Protocol. Every dispatch prompt MUST start with `Active task: <task path from \`task.py current\`>`, repo-root relative. Check/research fan-out runs at repo root, not in a worktree.

### Check pipeline template

Parallel review dimensions, main session reconciles. (The Workflow JS parser rejects nested template literals and full-width quotes — plain string concatenation, half-width quotes only.)

```javascript
const TASK = ".trellis/tasks/06-08-example";   // repo-root-relative task dir
const ACTIVE = "Active task: " + TASK + "\n\n";
const dims = [
  { n: "spec",        body: "dimension SPEC COMPLIANCE only. Read " + TASK + "/prd.md and every spec in " + TASK + "/check.jsonl, then git diff and verify the change follows them. Fix directly. No git commit/push/merge. No re-spawn." },
  { n: "cross-layer", body: "dimension CROSS-LAYER DATA FLOW only. Load " + TASK + "/prd.md + check.jsonl specs. Trace changed data across layers; flag type/contract/validation breaks. Fix directly. No git commit. No re-spawn." },
  { n: "security",    body: "dimension SECURITY and RESOURCE SAFETY only. Load " + TASK + "/prd.md. Check authz, injection, leaked secrets, unbounded loops, leaks. Fix directly. No git commit. No re-spawn." },
  { n: "adversarial", body: "dimension ADVERSARIAL VERIFICATION only. Load " + TASK + "/prd.md. Assume the diff is wrong; build concrete failing/edge inputs and prove pass/fail. REPORT only, do not silent-fix. No git commit. No re-spawn." },
];
const outs = [];
for (const d of dims) {
  outs.push(agent(ACTIVE + "You are trellis-check, " + d.body, { agentType: "trellis-check" }));
}
const results = [];
for (let i = 0; i < dims.length; i++) results.push("### " + dims[i].n + "\n" + (await outs[i]));
return results.join("\n\n");
```

The first three dimensions fix non-overlapping concerns directly; the adversarial dimension reports only. If write conflicts worry you, make all dimensions report-only and apply fixes serially in the main session.

### Implement worktree fan-out (experimental)

Only when the prd decomposes into independent units, and the task dir is already committed (each worktree must contain prd + jsonl). Agents write but never commit; the main session merges worktree branches back into the task branch before the Phase 3.4 commit. Keep off unless the user asks.

---

## Customizing

Edit this file directly — the hooks are parsers only. When you change a `[workflow-state:STATUS]` block, keep the tag pair matched and restart the session. Custom statuses: add a new block + a lifecycle hook in `task.json.hooks.after_*` that writes the status. The runtime parser is your platform's `inject-workflow-state.py` hook — it reads this file only, with no fallback text baked into the script.
