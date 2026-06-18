import { appendEvent } from "./events.js";
import { readChannelEvents } from "./events.js";
import { resolveTaskRef } from "./paths.js";
import { parseCsv } from "./schema.js";
import { appendChannelActivity } from "./activity.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";

export interface CreateChannelOptions extends ChannelPathOptions {
  by?: string;
  cwd?: string;
  type?: string;
  task?: string;
  labels?: string;
  description?: string;
}

function parseChannelType(raw: string | undefined): "chat" | "forum" {
  if (raw === undefined || raw === "" || raw === "chat") return "chat";
  if (raw === "forum") return "forum";
  throw new Error(`Unknown channel type '${raw}' (expected chat or forum)`);
}

export async function createChannel(
  name: string,
  options: CreateChannelOptions = {},
): Promise<ChannelEvent> {
  const cwd = options.cwd ?? process.cwd();
  const existing = await readChannelEvents(name, options);
  if (existing.length > 0) {
    throw new Error(`Channel '${name}' already exists`);
  }
  const task = resolveTaskRef(options.task, cwd);
  const event = await appendEvent(
    name,
    {
      kind: "created",
      by: options.by ?? "main",
      cwd,
      channelType: parseChannelType(options.type),
      task,
      labels: parseCsv(options.labels),
      description: options.description,
    },
    options,
  );
  appendChannelActivity({
    cwd,
    project: options.project,
    task,
    channel: name,
    action: "channel_created",
    note: `channel ${options.project ?? "default"}/${name} created`,
  });
  return event;
}
