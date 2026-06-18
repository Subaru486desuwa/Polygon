import type {
  ChannelEvent,
  ChannelEventKind,
  ChannelTarget,
} from "./types.js";

export interface ChannelEventFilter {
  self: string;
  from?: string[];
  kind?: ChannelEventKind[];
  to?: string;
  includeProgress?: boolean;
}

function eventTarget(event: ChannelEvent): ChannelTarget | undefined {
  if ("to" in event) {
    return event.to;
  }
  return undefined;
}

function matchesTarget(target: ChannelTarget | undefined, expected: string): boolean {
  if (target === undefined) return true;
  if (typeof target === "string") return target === expected;
  return target.includes(expected);
}

export function matchesEventFilter(
  event: ChannelEvent,
  filter: ChannelEventFilter,
): boolean {
  if (filter.from !== undefined && !filter.from.includes(event.by)) {
    return false;
  }
  if (filter.kind !== undefined && !filter.kind.includes(event.kind)) {
    return false;
  }
  if (
    event.kind === "progress" &&
    filter.kind === undefined &&
    filter.includeProgress !== true
  ) {
    return false;
  }
  const target = filter.to ?? filter.self;
  return matchesTarget(eventTarget(event), target);
}
