import fs from "node:fs";
import path from "node:path";

import { readChannelEvents } from "./events.js";
import { channelRuntimeRoot, projectDir } from "./paths.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";
import { listWorkerRuntimes, type WorkerRuntimeEntry } from "./workers.js";

export interface ChannelListEntry {
  name: string;
  project: string;
  path: string;
  eventCount: number;
  lastEvent?: ChannelEvent;
  task?: string;
  title?: string;
  workers: WorkerRuntimeEntry[];
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function createdEvent(events: ChannelEvent[]): ChannelEvent | undefined {
  return events.find((event) => event.kind === "created");
}

export async function listChannels(
  options: ChannelPathOptions = {},
): Promise<ChannelListEntry[]> {
  const root =
    options.project !== undefined
      ? projectDir(options)
      : channelRuntimeRoot(options);
  if (!fs.existsSync(root)) return [];

  const channelDirs: { project: string; dir: string }[] = [];
  if (options.project !== undefined) {
    for (const entry of fs.readdirSync(root)) {
      const fullPath = path.join(root, entry);
      if (isDirectory(fullPath)) {
        channelDirs.push({ project: options.project, dir: fullPath });
      }
    }
  } else {
    for (const project of fs.readdirSync(root)) {
      const projectPath = path.join(root, project);
      if (!isDirectory(projectPath)) continue;
      for (const entry of fs.readdirSync(projectPath)) {
        const fullPath = path.join(projectPath, entry);
        if (isDirectory(fullPath)) {
          channelDirs.push({ project, dir: fullPath });
        }
      }
    }
  }

  const result: ChannelListEntry[] = [];
  for (const item of channelDirs) {
    const name = path.basename(item.dir);
    const events = await readChannelEvents(name, {
      cwd: options.cwd,
      project: item.project,
    });
    const created = createdEvent(events);
    result.push({
      name,
      project: item.project,
      path: item.dir,
      eventCount: events.length,
      lastEvent: events.at(-1),
      task:
        created !== undefined && "task" in created ? created.task : undefined,
      title:
        created !== undefined && "description" in created
          ? created.description
          : undefined,
      workers: listWorkerRuntimes({
        cwd: options.cwd,
        project: item.project,
      }).filter(
        (worker) =>
          worker.channel === name && (worker.alive || worker.reserved),
      ),
    });
  }

  return result.sort((a, b) =>
    `${a.project}/${a.name}`.localeCompare(`${b.project}/${b.name}`),
  );
}
