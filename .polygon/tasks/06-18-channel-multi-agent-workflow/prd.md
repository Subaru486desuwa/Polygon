# Design Channel-Based Multi-Agent Workflow

## Goal
Design Polygon's channel-based multi-agent workflow so future implementation can move beyond prompt injection and support durable coordination between human and AI agents. The design should reuse Trellis' proven channel-runtime ideas where they fit Polygon, while preserving Polygon's current production strengths: cross-platform template distribution, stdlib Python task/session scripts, and main-session-first workflow defaults.

## Requirements
* Add a first-class channel concept for collaboration sessions tied to an optional Polygon task.
* Define a durable event-log contract that can represent human messages, worker lifecycle, progress, done/error, interrupts, and channel metadata.
* Define a worker model that can support at least Claude and Codex providers through adapters without hard-coding one platform's CLI semantics into the channel core.
* Define spawn-time coordination: project-level worker budget, worker-name mutual exclusion, stale process handling, idle cleanup, and explicit kill/interrupt semantics.
* Define a context assembly model for workers that can consume task PRD/research/spec JSONL references while enforcing path jail, symlink, and file-size safeguards.
* Keep current task/session locks as task ownership, not as a substitute for worker/process coordination.
* Keep direct main-session implementation as the default workflow; channel workers are opt-in for parallelizable or context-heavy work.
* Make the first implementation slice local-only and repo-scoped; do not require a remote service.
* Preserve install/update reliability for generated projects. No native dependency or daemon requirement for the MVP.

## Acceptance Criteria
* [x] A channel architecture document exists with data model, storage layout, command surface, and lifecycle flow.
* [x] The MVP command surface is explicit and testable: `channel create`, `channel send`, `channel wait`, `channel spawn`, `channel kill`, `channel list`, and a one-shot `channel run` or equivalent.
* [x] The design explains how channel events link to `.polygon/tasks/<task>/activity.jsonl` without duplicating every channel event into task activity.
* [x] The design distinguishes task locks, channel locks, worker locks, and process liveness checks.
* [x] The design includes provider adapter boundaries for Claude/Codex and documents which platforms are out of scope for MVP.
* [x] The design includes context injection safety requirements based on Trellis' `context-loader.ts`.
* [x] The design includes a staged implementation plan with tests for event append ordering, wait filters, spawn conflict, stale lock recovery, and context path jailing.
* [x] The design identifies migration/update impact for generated project templates.

## Decision (ADR-lite)

Context: Polygon currently coordinates work through task records, per-session active-task pointers, task leases, and sub-agent prompt injection hooks. That solves "which task am I working on" but not "run several independent workers, route messages, wait for completion, interrupt them, and clean them up".

Decision: design a Polygon-native channel runtime as a separate TypeScript CLI subsystem, modeled after Trellis' channel runtime but not blindly copied. Keep `.polygon/scripts/task.py` as the production task/session path. The channel runtime should live in the package CLI layer first, with generated-project integration kept behind explicit commands and documented hooks.

Consequences: This creates a real coordination layer while avoiding a high-risk rewrite of task.py. It also means we need a clear boundary between workflow/task state and channel/process state, plus extra tests around filesystem locking and child-process lifecycle.

## Out of Scope
* Replacing `.polygon/scripts/task.py` or `.polygon/.runtime/sessions/`.
* Making every Polygon workflow step automatically spawn workers.
* Shipping a long-running background daemon.
* Supporting every configured AI platform in the first channel MVP.
* Remote/cloud channel synchronization.
* Browser UI or docs-site work.

## Research References
* `research/trellis-channel-runtime.md` - Upstream Trellis channel runtime behavior and the parts Polygon should adapt.
* `info.md` - Polygon channel workflow architecture, command surface, event/storage model, locking model, provider boundary, and implementation phases.

## Technical Notes
* Upstream reference checked on 2026-06-18: `mindfold-ai/Trellis` HEAD `a87b18fdc6d0edc75f7494ffe7ddef2aedb21f10`.
* Current Polygon CLI has only `init`, `update`, and `uninstall` top-level commands; channel commands would be new package CLI behavior.
* Current Polygon task ownership uses `.polygon/.runtime/task-locks/*.json` with `.polygon/.runtime/.task-lock-guard.lock`; this remains task-level protection only.
* Relevant specs: `.polygon/spec/cli/backend/index.md`, `.polygon/spec/cli/backend/directory-structure.md`, `.polygon/spec/cli/backend/quality-guidelines.md`, `.polygon/spec/cli/backend/error-handling.md`, `.polygon/spec/cli/unit-test/index.md`, and `.polygon/spec/guides/cross-layer-thinking-guide.md`.

## Implementation Progress

### 2026-06-18

* Implemented Phase 1 channel runtime skeleton in `packages/cli/src/commands/channel/`.
  * Commands: `channel create`, `channel send`, `channel wait`, `channel list`.
  * Runtime: repo-local `.polygon/.runtime/channels/<project>/<channel>/events.jsonl`.
  * Guarantees: channel-level append lock, monotonic `seq`, malformed-line tolerance, duplicate create rejection, missing-channel send rejection, wait-from-EOF default, `wait --all` sender aggregation, timeout exit code 124.
* Implemented Phase 2 safe context loader.
  * Supports direct files, directories, simple globs, and streamed JSONL manifests.
  * Enforces realpath jail under worker cwd, rejects absolute/relative/symlink escapes, skips seed rows, deduplicates real files, enforces hard file-size cap, emits large-file/total-size warnings, and sanitizes rendered headers.
* Implemented Phase 3 supervisor skeleton.
  * Adds `channel spawn`, `channel kill`, hidden `channel __supervisor`, worker runtime path helpers, project-level worker guard, per-worker lock, reservations, pid/config/log files, active worker listing, stale pid cleanup, and terminal lifecycle events.
  * Adds executable provider adapter boundaries for `shell`, `claude`, and `codex`. Shell remains an explicit command adapter; Claude/Codex now build external CLI invocations, receive a channel protocol prompt on stdin, and can be smoke-tested with Node shims without requiring real provider login state.
  * Adds supervisor inbox delivery for targeted `message` events, `interrupt_requested` to `interrupted` projection, idle timeout, total timeout, timeout warnings, and forced kill escalation after shutdown grace.
  * Adds `channel interrupt` and `channel run`. `channel run` creates/spawns/sends/waits as one operation and uses explicit event sequence tracking to avoid the fast-worker send/wait race.
  * Adds task activity projection for high-level milestones: channel created, worker spawned, worker completed, worker failed, and worker killed. Worker activity inherits the task link from the channel create event when spawn/run does not repeat `--task`.
  * Production smoke proves detached supervisors can spawn shell and Codex-adapter shim workers, deliver stdin messages, append `spawned`/`done`/`killed`/`interrupted`, satisfy waits, list runtime state, and project activity into `.polygon/tasks/<task>/activity.jsonl`.
* Verification run:
  * `pnpm --filter @subaru486/polygon lint`
  * `pnpm --filter @subaru486/polygon typecheck`
  * `pnpm --filter @subaru486/polygon test -- test/commands/channel/providers.test.ts test/commands/channel/context.test.ts test/commands/channel/events.test.ts test/commands/channel/commands.test.ts test/commands/channel/spawn.test.ts` (current script runs full Vitest suite)
  * `pnpm --filter @subaru486/polygon build`
  * CLI smoke against `packages/cli/dist/cli/index.js` for `channel run`, shell stdin delivery, Codex-adapter prompt delivery, create/spawn/wait/list, idle kill, interrupt, explicit kill, and task activity projection.

## Remaining Gap Against Trellis

* Claude/Codex adapters are executable external-CLI boundaries, but they do not yet parse provider-specific stdout into rich progress/thread events or perform provider-specific readiness handshakes.
* The event surface is still MVP-sized: no `messages`, `context`, `threads/forum`, `title`, `rm`, or `prune` command family yet.
* Provider defaults use the command names `claude` and `codex`; real-world auth/session behavior still needs manual validation on machines with those CLIs configured.
