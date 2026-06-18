# Channel Workflow Architecture

## Design Summary

Polygon should add a local channel runtime as a TypeScript CLI subsystem under `packages/cli/src/commands/channel/`. The runtime is separate from `.polygon/scripts/task.py`: tasks decide what work exists, sessions decide what the current human/AI window is doing, and channels coordinate multiple workers through a durable event log.

The main workflow stays unchanged:

1. Main session owns the task and reads PRD/specs.
2. Main session creates a channel only when work can benefit from parallel workers.
3. Workers join through explicit `polygon channel spawn`.
4. Main session sends targeted work with `polygon channel send --to <worker>`.
5. Main session waits for completion with `polygon channel wait`.
6. Main session reconciles results and remains the only actor that commits.

## Non-Negotiable Boundaries

Task state:

* Location: `.polygon/tasks/<task>/`.
* Owns PRD, research, context JSONL, task status, task activity.
* Existing `task.py start/current/finish/locks/unlock` remains authoritative for active task and task leases.

Channel state:

* Recommended MVP location: `.polygon/.runtime/channels/<project-key>/<channel>/`.
* Owns `events.jsonl`, channel lock, worker pid/config/log files, reservations, and optional projected metadata.
* Channel state is runtime state, not source-controlled task state.

Task activity bridge:

* Do not mirror every event into `activity.jsonl`.
* Append only high-level milestones to task activity: channel created for task, worker spawned, worker completed, worker failed/killed, channel closed.
* Store channel name/project key in the activity note so humans can inspect the detailed channel log.

## MVP Command Surface

`polygon channel create <name>`

* Creates channel runtime directory.
* Appends `created` event with `by`, `cwd`, optional `task`, labels, description, and context metadata.
* If `--task` is provided, resolves and stores repo-relative `.polygon/tasks/<task>`.

`polygon channel send <name> --as <agent> [--to <agent[,agent]>] <text>`

* Appends a message event.
* Supports `--stdin` and `--text-file`.
* Delivery validation modes can come later; MVP may allow append-only plus warning when target worker is unknown.

`polygon channel wait <name> --as <agent> [filters]`

* Tails `events.jsonl` from EOF by default.
* Filters: `--from`, `--to` defaulting to own agent, `--kind`, `--timeout`, and `--all`.
* Returns matching event JSON on stdout.

`polygon channel spawn <name> --provider <claude|codex> --as <worker>`

* Resolves context, builds supervisor config, reserves worker, enforces guard, starts detached supervisor.
* Worker remains idle until it receives a targeted/broadcast message.

`polygon channel kill <name> --to <worker>`

* Sends graceful shutdown to supervisor, then forced kill after grace period.
* Appends a terminal lifecycle event.

`polygon channel list`

* Lists channels, linked task, active workers, last event time, and terminal/non-terminal status.

`polygon channel run [name]`

* Optional MVP accelerator: create ephemeral channel, spawn one worker, send one message, wait for done/error, print final event, clean up.
* If implementation risk is high, defer this until create/send/wait/spawn/kill are stable.

Private command:

`polygon channel __supervisor <channel> <worker> <config-path>`

* Internal entrypoint only. Not documented as a user command.

## Event Model

Minimum event fields:

```ts
interface ChannelEventBase {
  seq: number;
  ts: string;
  kind: ChannelEventKind;
  by: string;
}
```

Minimum event kinds:

* `created`: channel metadata and optional linked task.
* `message`: human/agent message with `text` and optional `to`.
* `spawned`: worker lifecycle start with provider, pid, agent/context metadata.
* `progress`: optional worker progress.
* `done`: worker completed a turn.
* `error`: worker or supervisor error.
* `interrupted`: worker turn was interrupted.
* `killed`: worker shutdown/timeout/idle cleanup.
* `supervisor_warning`: timeout/health warning.
* `context`: channel context add/delete/list state changes, if included in MVP.

Append contract:

* Every append holds a channel-level lock.
* `seq` is `lastSeq + 1` read from the existing event log.
* Append writes exactly one JSON line and flushes through normal Node filesystem APIs.
* Bad/corrupt lines should not crash readers; they should be ignored with warnings in debug surfaces.

Wait contract:

* Default start position is EOF so old `done` events do not unblock a new wait.
* `--all --from a,b` waits until each named agent emits a matching event.
* Timeout exits non-zero and prints pending agents/filter information to stderr.

## Storage Layout

Recommended MVP:

```text
.polygon/.runtime/channels/
  <project-key>/
    <channel-name>/
      events.jsonl
      .lock
      workers/
        <worker>/
          config.json
          pid
          worker-pid
          reservation
          log
          shutdown-reason
```

Project key:

* Default to a stable hash of the repo root path.
* Optionally allow `--project <slug>` later for shared/global channels.
* Avoid storing under user home for MVP; repo-local runtime is easier to inspect and clean.

## Locking and Liveness

Task lease:

* Existing `.polygon/.runtime/task-locks/*.json`.
* Prevents two sessions from claiming the same task.
* Does not prove a worker process is alive.

Channel lock:

* Per-channel lock around event append and metadata mutations.
* Should be implemented with atomic lockfile creation or a cross-platform file lock helper.

Project worker guard:

* Per-project `.worker-guard.lock`.
* Serializes spawn budget checks across all channel names.
* Prevents two different worker names from both seeing the last free worker slot.

Worker lock:

* Per-worker lock around spawn/kill/reservation mutation.
* Prevents concurrent spawn and kill of the same worker.

Liveness:

* A worker is live only when durable event state says non-terminal and the supervisor pid exists and is alive.
* Stale pid files must not block new workers.
* Reservations count as live during spawn so concurrent spawns cannot exceed budget before `spawned` lands.

Defaults:

* Max live workers: 6 per project.
* Idle cleanup: 5 minutes.
* Shutdown grace: 3 seconds before escalation.
* All defaults should be configurable through CLI flags first, then env/config later.

## Provider Adapter Boundary

Adapter interface:

```ts
interface ChannelProviderAdapter {
  provider: "claude" | "codex";
  buildArgs(view: WorkerLaunchView): string[];
  createContext(): unknown;
  handshake?(runtime: WorkerRuntime): Promise<void>;
  encodeUserMessage(message: ChannelMessageEvent): string;
  parseStdout?(chunk: string, ctx: unknown): ChannelEventDraft[];
  isReady?(ctx: unknown): boolean;
}
```

MVP providers:

* Claude: likely uses `claude` CLI with append/system prompt options and stdin.
* Codex: likely needs special handling for thread/session readiness and developer instructions.

Out of scope for MVP:

* Cursor, Kiro, Gemini, Copilot, Qoder, Droid, CodeBuddy, Pi, Reasonix provider workers.
* Platforms without a stable non-interactive CLI process should remain hook/prompt-injection only until a provider adapter is proven.

## Worker Context Assembly

Context inputs:

* `--file <path-or-glob>`.
* `--jsonl <path>` using `{ "file": "...", "reason": "..." }` rows.
* Task-aware helper later: `--task-context implement|check|research` can expand the current task's JSONL files.

Safety rules:

* Resolve all paths relative to worker cwd.
* Realpath-jail every file under cwd.
* Refuse absolute paths outside cwd, `..` escapes, and symlinks escaping cwd.
* Stream JSONL manifests instead of loading huge files at once.
* Skip `_example` rows.
* Per-file hard cap: 1 MB.
* Per-file warning threshold: 200 KB.
* Total context warning threshold: 500 KB.
* Strip control characters from prompt headers.

Prompt layering:

* Channel protocol lives in system/developer instructions, not as the first user message.
* Agent role and context files are reference material and must not override channel protocol.
* Worker identity and channel name must be sanitized before entering prompt text.

## Multi-Agent Workflow

Recommended human workflow:

1. Create task with `task.py create`.
2. Start task with `task.py start`.
3. Write/confirm PRD.
4. Create channel: `polygon channel create <task-slug> --task <task-dir> --description "..."`
5. Spawn focused workers:
   * `researcher`: reads upstream/source docs and reports options.
   * `implementer`: edits scoped files if work is isolated.
   * `checker`: reviews diff/spec/test results.
6. Send targeted assignments with explicit boundaries and no commit/push permission.
7. Wait for `done`/`error`.
8. Main session reconciles, edits final code if needed, runs tests, and commits.

Worker rules:

* Worker prompt starts from channel protocol, then agent role, then context.
* Worker cannot spawn more workers unless explicitly allowed by the main session.
* Worker cannot commit, push, merge, or archive tasks.
* Worker reports modified files and evidence into the channel.

## Implementation Phases

Phase 1: event store and CLI skeleton

* Add `packages/cli/src/commands/channel/` modules.
* Implement channel path helpers, event types, lock helper, append/read/watch.
* Register `polygon channel create/send/wait/list`.
* Unit tests: event seq ordering, malformed line tolerance, wait filters, timeout behavior.

Phase 2: safe context loader

* Implement file/glob/JSONL context assembly with jail and size limits.
* Unit tests: path escape refusal, symlink escape refusal, large file skip, manifest streaming, header sanitization.

Phase 3: provider adapters and supervisor

* Implement adapter interface and initial Claude/Codex adapters.
* Implement supervisor config, spawn, stdout pump, inbox watcher, shutdown.
* Tests: spawn command config writing, duplicate worker rejection, stale pid recovery. Use child-process stubs where full provider CLIs are unavailable.

Phase 4: guard and lifecycle operations

* Add project worker guard, reservations, idle cleanup, kill/interrupt.
* Tests: budget enforcement, concurrent spawn simulation, reservation cleanup, kill terminal event ordering.

Phase 5: task integration and workflow polish

* Add `--task` links and high-level task activity bridge.
* Add optional `channel run`.
* Add generated-template docs/help and update/migration tests if channel files ship to generated projects.

## Test Strategy

Use Vitest under `packages/cli/test/commands/channel/` or mirrored files:

* Pure event-store tests use temp directories.
* Watch/wait tests use controlled writes and short timeouts.
* Lock tests simulate stale pid/lock files.
* Context tests create temp files/symlinks under temp cwd.
* Spawn/supervisor tests should stub provider executable with a small Node script, not require real Claude/Codex authentication.

Do not add hardcoded counts to registry/template tests. If channel command registration affects help or package exports, test command behavior rather than snapshotting full help text.

## Open Questions

* Should channel state ever be user-global for cross-repo coordination, or is repo-local enough for Polygon's workflow?
* Should `channel run` ship in the first code slice or wait until spawn/wait are stable?
* Should worker context use task JSONL directly, or should there be a generated channel-specific manifest to avoid overloading implement/check context?
* How much of Trellis' thread/forum surface is needed for Polygon, if any?
