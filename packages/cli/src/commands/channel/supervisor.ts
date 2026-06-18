import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { appendEvent, readChannelEvents } from "./events.js";
import { matchesEventFilter } from "./filter.js";
import { appendChannelActivity } from "./activity.js";
import { buildProviderSpawnSpec } from "./providers.js";
import {
  cleanupWorkerRuntime,
  processAlive,
  readPid,
} from "./workers.js";
import { workerFile } from "./paths.js";
import type { ChannelEvent, ChannelPathOptions, MessageChannelEvent } from "./types.js";
import type { ChannelProviderConfig } from "./providers.js";

const SHUTDOWN_GRACE_MS = 3_000;

export interface SupervisorConfig extends ChannelPathOptions {
  provider: ChannelProviderConfig;
  cwd: string;
  channel: string;
  worker: string;
  by: string;
  prompt?: string;
  contextFiles?: string[];
  contextManifests?: string[];
  task?: string;
  idleTimeoutMs?: number;
  timeoutMs?: number;
  warnBeforeMs?: number;
}

export function writeSupervisorConfig(config: SupervisorConfig): string {
  const dir = path.dirname(
    workerFile(config.channel, config.worker, "config.json", config),
  );
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

function readSupervisorConfig(configPath: string): SupervisorConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Invalid supervisor config: ${configPath}`);
  }
  return raw as SupervisorConfig;
}

function writeLog(config: SupervisorConfig, message: string): void {
  const logPath = workerFile(config.channel, config.worker, "log", config);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${message}\n`, "utf-8");
}

function readInboxCursor(config: SupervisorConfig): number {
  return readPid(workerFile(config.channel, config.worker, "inbox-cursor", config)) ?? 0;
}

function writeInboxCursor(config: SupervisorConfig, seq: number): void {
  fs.writeFileSync(
    workerFile(config.channel, config.worker, "inbox-cursor", config),
    String(seq),
    "utf-8",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageText(event: MessageChannelEvent): string {
  return `${event.text.endsWith("\n") ? event.text : `${event.text}\n`}`;
}

function shouldDeliver(event: ChannelEvent, config: SupervisorConfig): event is MessageChannelEvent {
  return (
    event.kind === "message" &&
    matchesEventFilter(event, {
      self: config.worker,
      to: config.worker,
      kind: ["message"],
    })
  );
}

function shouldInterrupt(
  event: ChannelEvent,
  config: SupervisorConfig,
): event is ChannelEvent & { kind: "interrupt_requested" } {
  return event.kind === "interrupt_requested" && event.to === config.worker;
}

async function pumpInbox(
  config: SupervisorConfig,
  childStdin: NodeJS.WritableStream,
  shouldStop: () => boolean,
  markActivity: () => void,
): Promise<void> {
  let cursor = readInboxCursor(config);
  while (!shouldStop()) {
    const events = await readChannelEvents(config.channel, config);
    for (const event of events) {
      if (event.seq <= cursor) continue;
      cursor = event.seq;
      if (shouldDeliver(event, config)) {
        childStdin.write(messageText(event));
        markActivity();
      } else if (shouldInterrupt(event, config)) {
        await appendEvent(
          config.channel,
          {
            kind: "interrupted",
            by: `supervisor:${config.worker}`,
            to: config.worker,
            reason: event.reason ?? "user",
            outcome: "interrupted",
          },
          config,
        );
        markActivity();
      }
      writeInboxCursor(config, cursor);
    }
    await sleep(100);
  }
}

async function appendKilledIfAlive(
  config: SupervisorConfig,
  signal: NodeJS.Signals,
  reason = "explicit-kill",
): Promise<void> {
  await appendEvent(
    config.channel,
    {
      kind: "killed",
      by: `supervisor:${config.worker}`,
      to: config.worker,
      reason,
      signal,
    },
    config,
  );
  appendChannelActivity({
    cwd: config.cwd,
    project: config.project,
    task: config.task,
    channel: config.channel,
    action: "worker_killed",
    note: `worker ${config.worker} killed in channel ${config.channel}: ${reason}`,
  });
}

export async function runSupervisor(configPath: string): Promise<void> {
  const config = readSupervisorConfig(configPath);
  const pidPath = workerFile(config.channel, config.worker, "pid", config);
  fs.mkdirSync(path.dirname(pidPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(pidPath, String(process.pid), "utf-8");

  let terminalEventWritten = false;
  let stopInbox = false;
  let childStarted = false;
  let childProcess: ReturnType<typeof spawn> | null = null;
  const startedAt = Date.now();
  let lastActivity = Date.now();
  let timeoutWarningSent = false;
  const markActivity = (): void => {
    lastActivity = Date.now();
  };
  const writeTerminalKilled = async (
    signal: NodeJS.Signals,
    reason = "explicit-kill",
  ): Promise<void> => {
    if (terminalEventWritten) return;
    terminalEventWritten = true;
    stopInbox = true;
    await appendKilledIfAlive(config, signal, reason);
    if (childProcess !== null) {
      try {
        childProcess.stdin?.end();
      } catch {
        // Already closed.
      }
      try {
        childProcess.kill(signal);
      } catch {
        // Already dead.
      }
      await sleep(SHUTDOWN_GRACE_MS);
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        try {
          childProcess.kill("SIGKILL");
        } catch {
          // Already dead.
        }
      }
    }
    cleanupWorkerRuntime(config.channel, config.worker, config);
  };

  process.once("SIGTERM", () => {
    void writeTerminalKilled("SIGTERM").finally(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void writeTerminalKilled("SIGINT").finally(() => process.exit(0));
  });

  const spawnSpec = buildProviderSpawnSpec(config.provider, config.prompt);

  writeLog(
    config,
    `[supervisor] starting ${config.provider.provider} command: ${spawnSpec.command} ${spawnSpec.args.join(" ")}`,
  );

  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: config.cwd,
    env: {
      ...process.env,
      POLYGON_CHANNEL: config.channel,
      POLYGON_CHANNEL_AS: config.worker,
      POLYGON_HOOKS: "0",
    },
    stdio: [spawnSpec.stdin ? "pipe" : "ignore", "pipe", "pipe"],
  });
  childProcess = child;

  const workerPidPath = workerFile(
    config.channel,
    config.worker,
    "worker-pid",
    config,
  );

  child.stdout?.on("data", (chunk: Buffer) => {
    markActivity();
    writeLog(config, chunk.toString("utf-8").trimEnd());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    markActivity();
    writeLog(config, chunk.toString("utf-8").trimEnd());
  });

  const timeoutTimer =
    config.timeoutMs !== undefined && config.timeoutMs > 0
      ? setTimeout(() => {
          if (childStarted && !terminalEventWritten) {
            void writeTerminalKilled("SIGTERM", "timeout");
          }
        }, config.timeoutMs)
      : undefined;
  const supervisorTick = setInterval(() => {
    if (terminalEventWritten) return;
    const now = Date.now();
    if (
      config.timeoutMs !== undefined &&
      config.warnBeforeMs !== undefined &&
      config.warnBeforeMs > 0 &&
      !timeoutWarningSent &&
      now - startedAt >= Math.max(0, config.timeoutMs - config.warnBeforeMs)
    ) {
      timeoutWarningSent = true;
      void appendEvent(
        config.channel,
        {
          kind: "supervisor_warning",
          by: `supervisor:${config.worker}`,
          to: config.worker,
          message: `worker will time out in ${config.warnBeforeMs}ms`,
        },
        config,
      );
    }
    if (
      config.idleTimeoutMs !== undefined &&
      config.idleTimeoutMs > 0 &&
      now - lastActivity >= config.idleTimeoutMs
    ) {
      void writeTerminalKilled("SIGTERM", "idle-timeout");
    }
  }, 100);

  const writeInitialInput = (): void => {
    if (
      spawnSpec.initialInput === undefined ||
      spawnSpec.initialInput.length === 0 ||
      child.stdin === null
    ) {
      return;
    }
    child.stdin.write(
      spawnSpec.initialInput.endsWith("\n")
        ? spawnSpec.initialInput
        : `${spawnSpec.initialInput}\n`,
    );
    markActivity();
  };

  await new Promise<void>((resolve) => {
    child.once("spawn", () => {
      childStarted = true;
      if (child.pid !== undefined) {
        fs.writeFileSync(workerPidPath, String(child.pid), "utf-8");
      }
      void appendEvent(
        config.channel,
        {
          kind: "spawned",
          by: config.by,
          as: config.worker,
          provider: config.provider.provider,
          pid: child.pid,
          files: config.contextFiles,
          manifests: config.contextManifests,
        },
        config,
      ).finally(() => {
        writeInitialInput();
        appendChannelActivity({
          cwd: config.cwd,
          project: config.project,
          task: config.task,
          channel: config.channel,
          action: "worker_spawned",
          note: `worker ${config.worker} spawned in channel ${config.channel}`,
        });
        resolve();
      });
    });

    child.once("error", (error) => {
      terminalEventWritten = true;
      void appendEvent(
        config.channel,
        {
          kind: "error",
          by: `supervisor:${config.worker}`,
          message: `worker spawn failed: ${error.message}`,
          provider: config.provider.provider,
        },
        config,
      ).finally(() => {
        appendChannelActivity({
          cwd: config.cwd,
          project: config.project,
          task: config.task,
          channel: config.channel,
          action: "worker_failed",
          note: `worker ${config.worker} failed to spawn in channel ${config.channel}: ${error.message}`,
        });
        resolve();
      });
    });
  });

  if (terminalEventWritten) {
    cleanupWorkerRuntime(config.channel, config.worker, config);
    process.exitCode = 1;
    return;
  }

  if (spawnSpec.stdin && child.stdin !== null) {
    void pumpInbox(
      config,
      child.stdin,
      () => stopInbox || terminalEventWritten,
      markActivity,
    );
  }

  await new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      void (async () => {
        stopInbox = true;
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        clearInterval(supervisorTick);
        if (!terminalEventWritten) {
          terminalEventWritten = true;
          if (code === 0) {
            await appendEvent(
              config.channel,
              {
                kind: "done",
                by: config.worker,
                text: "worker completed",
              },
              config,
            );
            appendChannelActivity({
              cwd: config.cwd,
              project: config.project,
              task: config.task,
              channel: config.channel,
              action: "worker_completed",
              note: `worker ${config.worker} completed in channel ${config.channel}`,
            });
          } else {
            await appendEvent(
              config.channel,
              {
                kind: "error",
                by: `supervisor:${config.worker}`,
                message:
                  signal !== null
                    ? `worker exited by signal ${signal}`
                    : `worker exited with code ${code ?? "unknown"}`,
                provider: config.provider.provider,
              },
              config,
            );
            appendChannelActivity({
              cwd: config.cwd,
              project: config.project,
              task: config.task,
              channel: config.channel,
              action: "worker_failed",
              note: `worker ${config.worker} failed in channel ${config.channel}`,
            });
          }
        }
        cleanupWorkerRuntime(config.channel, config.worker, config);
        resolve();
      })();
    });
  });
}

export function terminateSupervisor(
  channelName: string,
  workerName: string,
  options: ChannelPathOptions = {},
): boolean {
  const supervisorPid = readPid(workerFile(channelName, workerName, "pid", options));
  if (supervisorPid === undefined || !processAlive(supervisorPid)) {
    cleanupWorkerRuntime(channelName, workerName, options);
    return false;
  }
  fs.writeFileSync(
    workerFile(channelName, workerName, "shutdown-reason", options),
    "explicit-kill",
    "utf-8",
  );
  process.kill(supervisorPid, "SIGTERM");
  return true;
}
