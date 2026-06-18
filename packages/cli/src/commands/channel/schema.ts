import {
  CHANNEL_EVENT_KINDS,
  type ChannelEventKind,
} from "./types.js";

export function parseCsv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

export function parseChannelKinds(
  value: string | undefined,
): ChannelEventKind[] | undefined {
  const items = parseCsv(value);
  if (items === undefined) return undefined;

  const allowed = new Set<string>(CHANNEL_EVENT_KINDS);
  const parsed: ChannelEventKind[] = [];
  for (const item of items) {
    if (!allowed.has(item)) {
      throw new Error(
        `Unknown channel event kind '${item}' (expected one of ${CHANNEL_EVENT_KINDS.join(", ")})`,
      );
    }
    parsed.push(item as ChannelEventKind);
  }
  return parsed;
}

export function normalizeChannelName(name: string): string {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid channel name '${name}'. Use only letters, numbers, dot, underscore, or hyphen.`,
    );
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid channel name '${name}'.`);
  }
  return trimmed;
}
