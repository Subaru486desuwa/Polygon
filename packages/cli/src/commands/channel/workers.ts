import fs from "node:fs";
import path from "node:path";

import { projectDir, workerDir, workerFile } from "./paths.js";
import type { ChannelPathOptions } from "./types.js";

const RESERVATION_TTL_MS = 30_000;

export interface WorkerRuntimeEntry {
  channel: string;
  worker: string;
  pid?: number;
  alive: boolean;
  reserved: boolean;
  path: string;
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPid(filePath: string): number | undefined {
  try {
    const pid = Number(fs.readFileSync(filePath, "utf-8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export function cleanupWorkerRuntime(
  channelName: string,
  workerName: string,
  options: ChannelPathOptions = {},
): void {
  for (const fileName of ["pid", "worker-pid", "reservation", "shutdown-reason"]) {
    try {
      fs.rmSync(workerFile(channelName, workerName, fileName, options), {
        force: true,
      });
    } catch {
      // Best-effort cleanup.
    }
  }
  try {
    fs.rmdirSync(workerDir(channelName, workerName, options));
  } catch {
    // Keep non-empty worker dirs (for logs/config) or ignore concurrent cleanup.
  }
}

function reservationIsFresh(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs <= RESERVATION_TTL_MS;
  } catch {
    return false;
  }
}

export function getWorkerRuntime(
  channelName: string,
  workerName: string,
  options: ChannelPathOptions = {},
): WorkerRuntimeEntry {
  const pidPath = workerFile(channelName, workerName, "pid", options);
  const reservationPath = workerFile(
    channelName,
    workerName,
    "reservation",
    options,
  );
  const pid = readPid(pidPath);
  const alive = pid !== undefined && processAlive(pid);
  const reserved = reservationIsFresh(reservationPath);

  if (!alive && pid !== undefined && !reserved) {
    cleanupWorkerRuntime(channelName, workerName, options);
  }

  return {
    channel: channelName,
    worker: workerName,
    pid,
    alive,
    reserved,
    path: workerDir(channelName, workerName, options),
  };
}

export function listWorkerRuntimes(
  options: ChannelPathOptions = {},
): WorkerRuntimeEntry[] {
  const projectRoot = projectDir(options);
  if (!fs.existsSync(projectRoot)) return [];

  const result: WorkerRuntimeEntry[] = [];
  for (const channelName of fs.readdirSync(projectRoot)) {
    const workersRoot = path.join(projectRoot, channelName, "workers");
    if (!fs.existsSync(workersRoot)) continue;
    for (const workerName of fs.readdirSync(workersRoot)) {
      const workerPath = path.join(workersRoot, workerName);
      try {
        if (!fs.statSync(workerPath).isDirectory()) continue;
      } catch {
        continue;
      }
      result.push(getWorkerRuntime(channelName, workerName, options));
    }
  }

  return result.sort((a, b) =>
    `${a.channel}/${a.worker}`.localeCompare(`${b.channel}/${b.worker}`),
  );
}
