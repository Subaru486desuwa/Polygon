# Trellis Channel Runtime Research

Reference: `mindfold-ai/Trellis` at `a87b18fdc6d0edc75f7494ffe7ddef2aedb21f10`, cloned locally to `/tmp/trellis-channel.rIotIv` during this design pass.

## What Trellis Actually Implements

Trellis' `channel` command is a local multi-agent collaboration runtime. Its CLI surface includes channel creation, message send, event wait, interrupt, spawn, one-shot run, kill, list, messages, context, threads/forum, title, rm/prune, and a private `__supervisor` entrypoint.

The core model is:

* A channel is a durable local directory with an `events.jsonl` log.
* Events are appended under a channel lock and assigned monotonically increasing `seq` values.
* `send` appends a message event with `by`, optional `to`, delivery mode, and body.
* `wait` tails the event log with filters such as self, from, kind, to, thread, action, include-progress, timeout, and all-agents semantics.
* `spawn` starts a detached supervisor for a named worker. The worker id is the channel identity for later `send --to`.
* The supervisor bridges a provider CLI process to channel events through three loops: stdout pump, inbox watcher, and signal/timeout shutdown.

## Spawn and Worker Guard Details

Important Trellis safeguards:

* `spawn.ts` resolves agent/provider/model/context first, then enforces worker guard policy before forking a supervisor.
* A project-level `.worker-guard.lock` serializes live-worker budget checks. A per-worker lock prevents concurrent spawn/kill races for the same worker name.
* Built-in defaults are 5 minutes idle cleanup and 6 max live workers per project/scope, with CLI flag, env, and config overrides.
* Spawn writes a reservation before detaching the supervisor. The guard scanner treats reservations as in-flight workers so concurrent spawns cannot overrun the budget.
* The supervisor writes its pid and worker child pid. Stale pid files are ignored by liveness checks if the process is dead.
* Timeout/idle cleanup eventually writes terminal events such as `killed`, not just process logs.

## Supervisor Details

Trellis' supervisor is the main difference from Polygon's current sub-agent prompt hook. It owns an actual provider process:

* Builds provider-specific args through an adapter.
* Injects channel protocol into the worker system prompt, not as the first user message.
* Sets `TRELLIS_HOOKS=0`, `TRELLIS_CHANNEL`, and `TRELLIS_CHANNEL_AS` for workers to prevent recursive hook behavior and expose channel identity.
* Attaches child process error/exit/signal handlers before awaiting startup to avoid stale pid files and orphaned workers.
* Writes `spawned` only after the worker process really starts.
* Starts an inbox watcher before adapter handshake so messages sent during startup are not lost.
* Converts worker stdout into channel events through provider-specific parsing.

## Context Loader Details

Trellis context assembly is safer than Polygon's current sub-agent JSONL hook:

* `--file` and `--jsonl` paths are resolved relative to worker cwd.
* Every path is jailed by realpath so absolute paths, `..` escapes, and symlinks outside cwd are refused.
* JSONL manifests are streamed line by line.
* Seed/example entries are skipped.
* Per-file hard cap is 1 MB, warning threshold is 200 KB, and total context warning threshold is 500 KB.
* Header path/reason strings strip control characters before entering the system prompt.

Polygon should adapt these safety rules for any channel worker context assembly.

## Polygon Mapping

Reuse or adapt:

* Event log with seq and file lock.
* `send`/`wait` filter model.
* Project-level guard plus per-worker lock.
* Provider adapters.
* Supervisor process that bridges stdin/stdout and handles lifecycle events.
* Safe context assembly from files and JSONL.

Do not directly map:

* `.trellis` names and env vars; use `.polygon`, `POLYGON_CHANNEL`, and `POLYGON_CHANNEL_AS`.
* Trellis-specific core package dependency unless Polygon intentionally adopts a shared core package.
* Automatic worker spawning in normal workflow phases. Polygon should keep main-session-first behavior.

Open design decisions:

* Whether channel state should live under `.polygon/.runtime/channels/` or a user-global directory. MVP should prefer repo-local runtime state for transparency and cleanup.
* Whether `channel run` should be part of MVP or Phase 2. It is useful as an end-to-end smoke test, but `create/send/wait/spawn/kill/list` are the minimum composable primitives.
* Whether first worker providers should be Claude and Codex only. Recommended: yes, because they are the platforms with known agent/process semantics in this repo today.
