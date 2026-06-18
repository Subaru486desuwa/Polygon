import { appendEvent } from "./events.js";
import { terminateSupervisor } from "./supervisor.js";
import type { ChannelPathOptions } from "./types.js";

export interface KillChannelWorkerOptions extends ChannelPathOptions {
  by?: string;
}

export async function killChannelWorker(
  channelName: string,
  workerName: string,
  options: KillChannelWorkerOptions = {},
): Promise<boolean> {
  const signaled = terminateSupervisor(channelName, workerName, options);
  if (!signaled) {
    await appendEvent(
      channelName,
      {
        kind: "killed",
        by: options.by ?? "main",
        to: workerName,
        reason: "not-running",
      },
      options,
    );
  }
  return signaled;
}
