import { parseChannelKinds, parseCsv } from "./schema.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";
import { watchEvents } from "./watch.js";

export interface WaitChannelOptions extends ChannelPathOptions {
  as: string;
  timeoutMs?: number;
  from?: string;
  kind?: string;
  to?: string;
  includeProgress?: boolean;
  all?: boolean;
  pollMs?: number;
  sinceSeq?: number;
  fromStart?: boolean;
}

const TIMEOUT_EXIT_CODE = 124;

export function parseDuration(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid duration: ${value} (use Nms, Ns, Nm, or Nh)`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    default:
      return amount * 1_000;
  }
}

export async function waitForChannelEvent(
  name: string,
  options: WaitChannelOptions,
): Promise<ChannelEvent | null> {
  const fromList = parseCsv(options.from);
  if (options.all === true && (fromList === undefined || fromList.length === 0)) {
    throw new Error("--all requires --from <a,b,...>");
  }

  const abort = new AbortController();
  const timer =
    options.timeoutMs !== undefined
      ? setTimeout(() => abort.abort(), options.timeoutMs)
      : undefined;
  const pending = options.all === true ? new Set(fromList) : null;

  try {
    for await (const event of watchEvents(
      name,
      {
        self: options.as,
        from: fromList,
        kind: parseChannelKinds(options.kind),
        to: options.to ?? options.as,
        includeProgress: options.includeProgress,
      },
      {
        cwd: options.cwd,
        project: options.project,
        signal: abort.signal,
        pollMs: options.pollMs,
        sinceSeq: options.sinceSeq,
        fromStart: options.fromStart,
      },
    )) {
      if (pending === null) return event;
      pending.delete(event.by);
      if (pending.size === 0) return event;
    }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  if (pending !== null && pending.size > 0) {
    process.stderr.write(
      `timeout: still waiting on ${[...pending].join(",")}\n`,
    );
  }
  process.exitCode = TIMEOUT_EXIT_CODE;
  return null;
}
