import fs from "node:fs";
import path from "node:path";

import { findPolygonRoot, resolveTaskRef } from "./paths.js";
import type { ChannelPathOptions } from "./types.js";

export type ChannelActivityAction =
  | "channel_created"
  | "worker_spawned"
  | "worker_completed"
  | "worker_failed"
  | "worker_killed";

export interface ChannelActivityOptions extends ChannelPathOptions {
  task?: string;
  channel: string;
  project?: string;
  action: ChannelActivityAction;
  note: string;
  platform?: string;
  session?: string;
}

interface ActivityRecord {
  ts: string;
  platform: string;
  model: null;
  session: string | null;
  action: ChannelActivityAction;
  note: string;
}

function resolveTaskDir(
  taskRef: string | undefined,
  cwd: string,
): string | undefined {
  if (taskRef === undefined) return undefined;
  const repoRoot = findPolygonRoot(cwd);
  const rel = resolveTaskRef(taskRef, cwd);
  return rel === undefined ? undefined : path.join(repoRoot, rel);
}

export function appendChannelActivity(options: ChannelActivityOptions): void {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = findPolygonRoot(cwd);
  const taskDir = resolveTaskDir(options.task, cwd);
  if (taskDir === undefined) return;

  const record: ActivityRecord = {
    ts: new Date().toISOString(),
    platform: options.platform ?? "polygon-channel",
    model: null,
    session:
      options.session ??
      `${options.project ?? path.basename(repoRoot)}/${options.channel}`,
    action: options.action,
    note: options.note,
  };

  try {
    fs.appendFileSync(
      path.join(taskDir, "activity.jsonl"),
      `${JSON.stringify(record)}\n`,
      "utf-8",
    );
  } catch {
    // Activity projection is best-effort; channel event durability is primary.
  }
}
