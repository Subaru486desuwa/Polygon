import chalk from "chalk";
import { type Command } from "commander";

import { createChannel } from "./create.js";
import { listChannels } from "./list.js";
import { sendChannelMessage } from "./send.js";
import { parseMaxLiveWorkers, spawnChannelWorker } from "./spawn.js";
import { killChannelWorker } from "./kill.js";
import { interruptChannelWorker } from "./interrupt.js";
import { runChannelWorker } from "./run.js";
import { runSupervisor } from "./supervisor.js";
import {
  parseDuration,
  waitForChannelEvent,
} from "./wait.js";

function handleCommandError(error: unknown): never {
  console.error(
    chalk.red("Error:"),
    error instanceof Error ? error.message : error,
  );
  if (process.env.DEBUG || process.env.POLYGON_DEBUG) {
    console.error(error instanceof Error ? error.stack : error);
  }
  process.exit(1);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

export function registerChannelCommand(program: Command): void {
  const channel = program
    .command("channel")
    .description(
      "Local multi-agent channel runtime — create, send, wait, and inspect durable event logs",
    );

  channel
    .command("run <name> [text]")
    .description("Spawn one worker, optionally send a message, and wait for a terminal event")
    .requiredOption("--as <worker>", "worker name")
    .option("--project <slug>", "project bucket slug")
    .option("--provider <provider>", "provider: shell | claude | codex", "shell")
    .option("--command <command>", "shell provider command")
    .option("--args <csv>", "comma-separated shell command arguments")
    .option("--stdin", "keep shell worker stdin open and deliver targeted message")
    .option("--task <path>", "associated Polygon task directory for activity bridge")
    .option("--timeout <duration>", "max wait for terminal event")
    .option("--by <agent>", "agent name recorded as caller", "main")
    .action(
      async (
        name: string,
        text: string | undefined,
        raw: Record<string, unknown>,
      ) => {
        try {
          const opts = raw as {
            as: string;
            project?: string;
            provider?: string;
            command?: string;
            args?: string;
            stdin?: boolean;
            task?: string;
            timeout?: string;
            by?: string;
          };
          printJson(
            await runChannelWorker(name, {
              as: opts.as,
              project: opts.project,
              provider: opts.provider,
              command: opts.command,
              args: opts.args,
              stdin: opts.stdin,
              task: opts.task,
              timeoutMs: parseDuration(opts.timeout),
              by: opts.by,
              text,
            }),
          );
        } catch (error) {
          handleCommandError(error);
        }
      },
    );

  channel
    .command("spawn <name>")
    .description("Spawn a channel worker supervisor")
    .requiredOption("--as <worker>", "worker name")
    .option("--project <slug>", "project bucket slug")
    .option("--provider <provider>", "provider: shell | claude | codex", "shell")
    .option("--command <command>", "shell provider command")
    .option("--args <csv>", "comma-separated shell command arguments")
    .option("--stdin", "keep shell worker stdin open and deliver targeted messages")
    .option("--file <path>", "context file/glob to load", collect, [])
    .option("--jsonl <path>", "context JSONL manifest to load", collect, [])
    .option("--task <path>", "associated Polygon task directory for activity bridge")
    .option("--idle-timeout <duration>", "kill worker after idle duration")
    .option("--timeout <duration>", "kill worker after total duration")
    .option("--warn-before <duration>", "emit supervisor_warning before timeout")
    .option("--max-live-workers <count>", "project worker budget")
    .option("--by <agent>", "agent name recorded as spawning worker", "main")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        const opts = raw as {
          as: string;
          project?: string;
          provider?: string;
          command?: string;
          args?: string;
          stdin?: boolean;
          file?: string[];
          jsonl?: string[];
          task?: string;
          idleTimeout?: string;
          timeout?: string;
          warnBefore?: string;
          maxLiveWorkers?: string;
          by?: string;
        };
        printJson(
          await spawnChannelWorker(name, {
            as: opts.as,
            project: opts.project,
            provider: opts.provider,
            command: opts.command,
            args: opts.args,
            stdin: opts.stdin,
            files: opts.file,
            jsonl: opts.jsonl,
            task: opts.task,
            idleTimeoutMs: parseDuration(opts.idleTimeout),
            timeoutMs: parseDuration(opts.timeout),
            warnBeforeMs: parseDuration(opts.warnBefore),
            maxLiveWorkers: parseMaxLiveWorkers(opts.maxLiveWorkers),
            by: opts.by,
          }),
        );
      } catch (error) {
        handleCommandError(error);
      }
    });

  channel
    .command("kill <name> <worker>")
    .description("Stop a channel worker supervisor")
    .option("--project <slug>", "project bucket slug")
    .option("--by <agent>", "agent name recorded as killing worker", "main")
    .action(
      async (
        name: string,
        worker: string,
        raw: Record<string, unknown>,
      ) => {
        try {
          const opts = raw as { project?: string; by?: string };
          printJson({
            signaled: await killChannelWorker(name, worker, opts),
          });
        } catch (error) {
          handleCommandError(error);
        }
      },
    );

  channel
    .command("interrupt <name> <worker>")
    .description("Request interruption of a channel worker turn")
    .option("--project <slug>", "project bucket slug")
    .option("--reason <text>", "interrupt reason")
    .option("--by <agent>", "agent name recorded as interrupting worker", "main")
    .action(
      async (
        name: string,
        worker: string,
        raw: Record<string, unknown>,
      ) => {
        try {
          const opts = raw as {
            project?: string;
            reason?: string;
            by?: string;
          };
          printJson(
            await interruptChannelWorker(name, worker, {
              project: opts.project,
              reason: opts.reason,
              by: opts.by,
            }),
          );
        } catch (error) {
          handleCommandError(error);
        }
      },
    );

  channel
    .command("__supervisor <configPath>", { hidden: true })
    .action(async (configPath: string) => {
      try {
        await runSupervisor(configPath);
      } catch (error) {
        handleCommandError(error);
      }
    });

  channel
    .command("create <name>")
    .description("Create a channel collaboration session")
    .option("--project <slug>", "project bucket slug")
    .option("--type <type>", "channel type: chat | forum", "chat")
    .option("--task <path>", "associated Polygon task directory")
    .option("--labels <csv>", "comma-separated labels")
    .option("--description <text>", "stable channel description")
    .option("--cwd <path>", "working directory recorded in the create event")
    .option("--by <agent>", "agent name recorded as the creator", "main")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        const opts = raw as {
          project?: string;
          type?: string;
          task?: string;
          labels?: string;
          description?: string;
          cwd?: string;
          by?: string;
        };
        printJson(await createChannel(name, opts));
      } catch (error) {
        handleCommandError(error);
      }
    });

  channel
    .command("send <name> [text]")
    .description("Send a message into a channel")
    .requiredOption("--as <agent>", "agent name sending the message")
    .option("--project <slug>", "project bucket slug")
    .option("--to <agents>", "comma-separated target agents")
    .option("--stdin", "read message body from stdin")
    .option("--text-file <path>", "read message body from file")
    .action(
      async (
        name: string,
        text: string | undefined,
        raw: Record<string, unknown>,
      ) => {
        try {
          const opts = raw as {
            as: string;
            project?: string;
            to?: string;
            stdin?: boolean;
            textFile?: string;
          };
          printJson(
            await sendChannelMessage(name, {
              ...opts,
              text,
            }),
          );
        } catch (error) {
          handleCommandError(error);
        }
      },
    );

  channel
    .command("wait <name>")
    .description("Block until a matching channel event arrives")
    .requiredOption("--as <agent>", "agent name waiting")
    .option("--project <slug>", "project bucket slug")
    .option("--timeout <duration>", "max wait (e.g. 30s, 2m, 1h)")
    .option("--from <agents>", "only wake on events from these agents")
    .option("--kind <kind[,kind...]>", "only wake on event kinds")
    .option("--to <target>", "only wake on events targeted to this name")
    .option("--include-progress", "also wake on progress events")
    .option("--all", "wait until each agent in --from has matched")
    .option("--since-seq <seq>", "only consider events after this sequence")
    .option("--from-start", "read matching events from the beginning")
    .action(async (name: string, raw: Record<string, unknown>) => {
      try {
        const opts = raw as {
          as: string;
          project?: string;
          timeout?: string;
          from?: string;
          kind?: string;
          to?: string;
          includeProgress?: boolean;
          all?: boolean;
          sinceSeq?: string;
          fromStart?: boolean;
        };
        const event = await waitForChannelEvent(name, {
          as: opts.as,
          project: opts.project,
          timeoutMs: parseDuration(opts.timeout),
          from: opts.from,
          kind: opts.kind,
          to: opts.to,
          includeProgress: opts.includeProgress,
          all: opts.all,
          sinceSeq: parseSeq(opts.sinceSeq),
          fromStart: opts.fromStart,
        });
        if (event !== null) {
          printJson(event);
        }
      } catch (error) {
        handleCommandError(error);
      }
    });

  channel
    .command("list")
    .description("List channels in the current Polygon project")
    .option("--project <slug>", "project bucket slug")
    .option("--json", "emit JSON")
    .action(async (raw: Record<string, unknown>) => {
      try {
        const opts = raw as { project?: string; json?: boolean };
        const entries = await listChannels({ project: opts.project });
        if (opts.json === true) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }
        if (entries.length === 0) {
          console.log("(no channels)");
          return;
        }
        for (const entry of entries) {
          const last =
            entry.lastEvent !== undefined
              ? `${entry.lastEvent.kind}#${entry.lastEvent.seq}`
              : "no-events";
          const task = entry.task !== undefined ? ` task=${entry.task}` : "";
          console.log(
            `${entry.project}/${entry.name} events=${entry.eventCount} last=${last}${task}`,
          );
        }
      } catch (error) {
        handleCommandError(error);
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseSeq(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--since-seq must be a non-negative integer: ${value}`);
  }
  return parsed;
}

export { createChannel } from "./create.js";
export { sendChannelMessage } from "./send.js";
export { spawnChannelWorker } from "./spawn.js";
export { killChannelWorker } from "./kill.js";
export { interruptChannelWorker } from "./interrupt.js";
export { runChannelWorker } from "./run.js";
export { waitForChannelEvent, parseDuration } from "./wait.js";
export { listChannels } from "./list.js";
export { appendEvent, readChannelEvents, readLastSeq } from "./events.js";
export {
  loadChannelContext,
  renderChannelContext,
  sanitizeContextHeader,
} from "./context.js";
export type {
  ChannelEvent,
  ChannelEventKind,
  AppendableChannelEvent,
} from "./types.js";
export type {
  ChannelContextFile,
  ChannelContextLoadResult,
  ChannelContextWarning,
} from "./context.js";
