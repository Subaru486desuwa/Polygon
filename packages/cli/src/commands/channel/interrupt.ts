import { appendEvent } from "./events.js";
import { getWorkerRuntime } from "./workers.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";

export interface InterruptChannelWorkerOptions extends ChannelPathOptions {
  by?: string;
  reason?: string;
}

export async function interruptChannelWorker(
  channelName: string,
  workerName: string,
  options: InterruptChannelWorkerOptions = {},
): Promise<ChannelEvent> {
  const event = await appendEvent(
    channelName,
    {
      kind: "interrupt_requested",
      by: options.by ?? "main",
      to: workerName,
      reason: options.reason,
    },
    options,
  );

  const runtime = getWorkerRuntime(channelName, workerName, options);
  if (!runtime.alive) {
    await appendEvent(
      channelName,
      {
        kind: "interrupted",
        by: options.by ?? "main",
        to: workerName,
        reason: options.reason ?? "not-running",
        outcome: "no-active-worker",
      },
      options,
    );
  }

  return event;
}
