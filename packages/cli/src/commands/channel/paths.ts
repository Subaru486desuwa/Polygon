import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import type { ChannelPathOptions } from "./types.js";
import { normalizeChannelName } from "./schema.js";

const DIR_RUNTIME = ".runtime";
const DIR_CHANNELS = "channels";

function sanitizeSegment(raw: string, fallback: string): string {
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : fallback;
}

export function findPolygonRoot(start: string = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, DIR_NAMES.WORKFLOW))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `Not inside a Polygon project (missing ${DIR_NAMES.WORKFLOW}/).`,
      );
    }
    current = parent;
  }
}

export function projectKeyForRoot(repoRoot: string): string {
  const baseName = sanitizeSegment(path.basename(repoRoot), "project");
  const digest = crypto
    .createHash("sha256")
    .update(path.resolve(repoRoot))
    .digest("hex")
    .slice(0, 12);
  return `${baseName}-${digest}`;
}

export function currentProjectKey(cwd: string = process.cwd()): string {
  return projectKeyForRoot(findPolygonRoot(cwd));
}

export function channelRuntimeRoot(options: ChannelPathOptions = {}): string {
  const repoRoot = findPolygonRoot(options.cwd);
  return path.join(
    repoRoot,
    DIR_NAMES.WORKFLOW,
    DIR_RUNTIME,
    DIR_CHANNELS,
  );
}

export function projectDir(options: ChannelPathOptions = {}): string {
  const repoRoot = findPolygonRoot(options.cwd);
  const project = options.project ?? projectKeyForRoot(repoRoot);
  return path.join(
    repoRoot,
    DIR_NAMES.WORKFLOW,
    DIR_RUNTIME,
    DIR_CHANNELS,
    sanitizeSegment(project, "project"),
  );
}

export function channelDir(
  channelName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(projectDir(options), normalizeChannelName(channelName));
}

export function eventsPath(
  channelName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(channelDir(channelName, options), "events.jsonl");
}

export function lockPath(
  channelName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(channelDir(channelName, options), ".lock");
}

export function projectWorkerGuardLock(
  options: ChannelPathOptions = {},
): string {
  return path.join(projectDir(options), ".worker-guard.lock");
}

export function workersDir(
  channelName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(channelDir(channelName, options), "workers");
}

export function workerDir(
  channelName: string,
  workerName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(workersDir(channelName, options), normalizeChannelName(workerName));
}

export function workerFile(
  channelName: string,
  workerName: string,
  fileName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(workerDir(channelName, workerName, options), fileName);
}

export function workerLockPath(
  channelName: string,
  workerName: string,
  options: ChannelPathOptions = {},
): string {
  return path.join(workerDir(channelName, workerName, options), ".lock");
}

export function resolveTaskRef(
  taskRef: string | undefined,
  cwd: string = process.cwd(),
): string | undefined {
  if (taskRef === undefined || taskRef.trim() === "") return undefined;

  const repoRoot = findPolygonRoot(cwd);
  const trimmed = taskRef.trim();
  const candidates = [
    path.isAbsolute(trimmed) ? trimmed : path.join(repoRoot, trimmed),
    path.join(repoRoot, DIR_NAMES.WORKFLOW, DIR_NAMES.TASKS, trimmed),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory()) continue;
    const resolved = path.resolve(candidate);
    const rel = path.relative(repoRoot, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Task path is outside the Polygon project: ${taskRef}`);
    }
    return rel.split(path.sep).join("/");
  }

  throw new Error(`Task not found: ${taskRef}`);
}
