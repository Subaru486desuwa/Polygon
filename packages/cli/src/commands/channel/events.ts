import fs from "node:fs";
import fsp from "node:fs/promises";

import {
  type AppendableChannelEvent,
  type ChannelEvent,
  CHANNEL_EVENT_KINDS,
  type ChannelPathOptions,
} from "./types.js";
import { channelDir, eventsPath, lockPath } from "./paths.js";
import { withLock } from "./lock.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEventLine(line: string): ChannelEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.seq !== "number") return null;
  if (typeof parsed.ts !== "string") return null;
  if (typeof parsed.kind !== "string") return null;
  if (!CHANNEL_EVENT_KINDS.includes(parsed.kind as ChannelEvent["kind"])) {
    return null;
  }
  if (typeof parsed.by !== "string") return null;
  return parsed as unknown as ChannelEvent;
}

export async function ensureChannelDir(
  name: string,
  options: ChannelPathOptions = {},
): Promise<string> {
  const dir = channelDir(name, options);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function readChannelEvents(
  name: string,
  options: ChannelPathOptions = {},
): Promise<ChannelEvent[]> {
  const file = eventsPath(name, options);
  if (!fs.existsSync(file)) return [];

  const text = await fsp.readFile(file, "utf-8");
  const events: ChannelEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const event = parseEventLine(trimmed);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}

export async function readLastSeq(
  name: string,
  options: ChannelPathOptions = {},
): Promise<number> {
  const events = await readChannelEvents(name, options);
  return events.reduce((max, event) => Math.max(max, event.seq), 0);
}

export async function appendEvent(
  name: string,
  partial: AppendableChannelEvent,
  options: ChannelPathOptions = {},
): Promise<ChannelEvent> {
  await ensureChannelDir(name, options);
  return withLock(lockPath(name, options), async () => {
    const seq = (await readLastSeq(name, options)) + 1;
    const { ts, ...rest } = partial;
    const event = {
      ...rest,
      seq,
      ts: ts ?? new Date().toISOString(),
    } as ChannelEvent;
    await fsp.appendFile(
      eventsPath(name, options),
      `${JSON.stringify(event)}\n`,
      "utf-8",
    );
    return event;
  });
}
