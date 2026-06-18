import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  channelDir,
  resolveTaskRef,
  projectWorkerGuardLock,
  workerFile,
  workerLockPath,
} from "./paths.js";
import { withLock } from "./lock.js";
import { readChannelEvents } from "./events.js";
import {
  getWorkerRuntime,
  listWorkerRuntimes,
} from "./workers.js";
import { loadChannelContext, renderChannelContext } from "./context.js";
import {
  buildAgentProviderConfig,
  buildWorkerPrompt,
  buildShellProviderConfig,
  parseChannelProvider,
  type ChannelProvider,
  type ChannelProviderConfig,
} from "./providers.js";
import { writeSupervisorConfig } from "./supervisor.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";

const DEFAULT_MAX_LIVE_WORKERS = 6;

export interface SpawnChannelOptions extends ChannelPathOptions {
  as: string;
  provider?: string;
  command?: string;
  args?: string;
  stdin?: boolean;
  by?: string;
  files?: string[];
  jsonl?: string[];
  task?: string;
  idleTimeoutMs?: number;
  timeoutMs?: number;
  warnBeforeMs?: number;
  maxLiveWorkers?: number;
  supervisorEntrypoint?: string;
}

export interface SpawnChannelResult {
  supervisorPid: number;
  worker: string;
  configPath: string;
  logPath: string;
}

export function parseMaxLiveWorkers(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--max-live-workers must be a non-negative integer: ${value}`);
  }
  return parsed;
}

function currentCliPath(): string {
  return fileURLToPath(new URL("../../cli/index.js", import.meta.url));
}

function buildProviderConfig(
  provider: ChannelProvider,
  options: SpawnChannelOptions,
): ChannelProviderConfig {
  if (provider === "shell") {
    return buildShellProviderConfig(options.command, options.args, options.stdin);
  }
  return buildAgentProviderConfig(provider, options.command, options.args, options.stdin);
}

function liveWorkerCount(options: ChannelPathOptions): number {
  return listWorkerRuntimes(options).filter(
    (entry) => entry.alive || entry.reserved,
  ).length;
}

function channelTaskRef(events: ChannelEvent[]): string | undefined {
  const created = events.find((event) => event.kind === "created");
  return created?.kind === "created" ? created.task : undefined;
}

export async function spawnChannelWorker(
  channelName: string,
  options: SpawnChannelOptions,
): Promise<SpawnChannelResult> {
  if (!fs.existsSync(channelDir(channelName, options))) {
    throw new Error(`Channel '${channelName}' not found`);
  }
  const channelEvents = await readChannelEvents(channelName, options);
  const provider = parseChannelProvider(options.provider);
  const providerConfig = buildProviderConfig(provider, options);
  const maxLiveWorkers = options.maxLiveWorkers ?? DEFAULT_MAX_LIVE_WORKERS;

  return withLock(projectWorkerGuardLock(options), async () => {
    const liveCount = liveWorkerCount(options);
    if (maxLiveWorkers > 0 && liveCount >= maxLiveWorkers) {
      throw new Error(
        `Channel worker budget exceeded (${liveCount}/${maxLiveWorkers} live workers)`,
      );
    }

    return withLock(workerLockPath(channelName, options.as, options), async () => {
      const runtime = getWorkerRuntime(channelName, options.as, options);
      if (runtime.alive || runtime.reserved) {
        throw new Error(
          `Worker '${options.as}' is already running in channel '${channelName}'`,
        );
      }

      const context = await loadChannelContext({
        cwd: options.cwd,
        files: options.files,
        jsonl: options.jsonl,
      });
      const cwd = options.cwd ?? process.cwd();
      const task = resolveTaskRef(options.task ?? channelTaskRef(channelEvents), cwd);
      const prompt =
        providerConfig.provider === "shell"
          ? undefined
          : buildWorkerPrompt({
              channel: channelName,
              worker: options.as,
              project: options.project,
              task,
              contextText: renderChannelContext(context),
            });
      const reservationPath = workerFile(
        channelName,
        options.as,
        "reservation",
        options,
      );
      fs.mkdirSync(path.dirname(reservationPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(reservationPath, String(Date.now()), "utf-8");

      const configPath = writeSupervisorConfig({
        cwd,
        project: options.project,
        channel: channelName,
        worker: options.as,
        by: options.by ?? "main",
        provider: providerConfig,
        prompt,
        contextFiles: context.files.map((file) => file.path),
        contextManifests: options.jsonl,
        task,
        idleTimeoutMs: options.idleTimeoutMs,
        timeoutMs: options.timeoutMs,
        warnBeforeMs: options.warnBeforeMs,
      });
      const logPath = workerFile(channelName, options.as, "log", options);
      const child = spawn(
        process.execPath,
        [
          options.supervisorEntrypoint ?? currentCliPath(),
          "channel",
          "__supervisor",
          configPath,
        ],
        {
          cwd: options.cwd ?? process.cwd(),
          detached: true,
          stdio: "ignore",
        },
      );
      child.unref();

      if (child.pid === undefined) {
        throw new Error("Failed to start channel supervisor");
      }

      return {
        supervisorPid: child.pid,
        worker: options.as,
        configPath,
        logPath,
      };
    });
  });
}
