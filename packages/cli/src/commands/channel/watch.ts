import fs from "node:fs";

import { channelDir, eventsPath } from "./paths.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";
import {
  matchesEventFilter,
  type ChannelEventFilter,
} from "./filter.js";

interface ReadProgress {
  byteOffset: number;
  carry: string;
}

export interface WatchOptions extends ChannelPathOptions {
  signal?: AbortSignal;
  fromStart?: boolean;
  sinceSeq?: number;
  pollMs?: number;
}

function parseEventLine(line: string): ChannelEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Partial<ChannelEvent>;
  if (
    typeof candidate.seq !== "number" ||
    typeof candidate.ts !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.by !== "string"
  ) {
    return null;
  }
  return parsed as ChannelEvent;
}

async function readNewEvents(
  filePath: string,
  state: ReadProgress,
): Promise<ChannelEvent[]> {
  if (!fs.existsSync(filePath)) {
    state.byteOffset = 0;
    state.carry = "";
    return [];
  }

  const stat = await fs.promises.stat(filePath);
  if (stat.size < state.byteOffset) {
    state.byteOffset = 0;
    state.carry = "";
  }
  if (stat.size <= state.byteOffset) return [];

  const fh = await fs.promises.open(filePath, "r");
  try {
    const length = stat.size - state.byteOffset;
    const buffer = Buffer.alloc(length);
    await fh.read(buffer, 0, length, state.byteOffset);
    state.byteOffset = stat.size;
    const text = state.carry + buffer.toString("utf-8");
    const lines = text.split("\n");
    state.carry = lines.pop() ?? "";

    const events: ChannelEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = parseEventLine(trimmed);
      if (event !== null) {
        events.push(event);
      }
    }
    return events;
  } finally {
    await fh.close();
  }
}

export async function* watchEvents(
  channelName: string,
  filter: ChannelEventFilter,
  options: WatchOptions = {},
): AsyncGenerator<ChannelEvent, void, unknown> {
  const dir = channelDir(channelName, options);
  const file = eventsPath(channelName, options);
  if (!fs.existsSync(dir)) {
    throw new Error(`Channel '${channelName}' not found at ${dir}`);
  }

  let initialOffset = 0;
  if (options.fromStart !== true && options.sinceSeq === undefined) {
    try {
      if (fs.existsSync(file)) {
        initialOffset = (await fs.promises.stat(file)).size;
      }
    } catch {
      initialOffset = 0;
    }
  }

  const state: ReadProgress = { byteOffset: initialOffset, carry: "" };
  const pollMs = options.pollMs ?? 200;
  let resolveNext: (() => void) | null = null;
  const wake = (): void => {
    if (resolveNext !== null) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve();
    }
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(dir, () => wake());
    watcher.on("error", () => {
      try {
        watcher?.close();
      } catch {
        // Already closed.
      }
      watcher = null;
      wake();
    });
  } catch {
    watcher = null;
  }

  const poll = setInterval(wake, pollMs);
  const abortHandler = (): void => wake();
  options.signal?.addEventListener("abort", abortHandler);

  try {
    while (true) {
      if (options.signal?.aborted) return;

      const fresh = await readNewEvents(file, state);
      for (const event of fresh) {
        if (options.sinceSeq !== undefined && event.seq <= options.sinceSeq) {
          continue;
        }
        if (matchesEventFilter(event, filter)) {
          yield event;
        }
        if (options.signal?.aborted) return;
      }

      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    clearInterval(poll);
    try {
      watcher?.close();
    } catch {
      // Already closed.
    }
    options.signal?.removeEventListener("abort", abortHandler);
  }
}
