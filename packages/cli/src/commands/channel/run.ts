import fs from "node:fs";

import { createChannel } from "./create.js";
import { sendChannelMessage } from "./send.js";
import { spawnChannelWorker, type SpawnChannelOptions } from "./spawn.js";
import { waitForChannelEvent } from "./wait.js";
import { channelDir } from "./paths.js";
import type { ChannelEvent, ChannelPathOptions } from "./types.js";

export interface RunChannelOptions extends SpawnChannelOptions {
  text?: string;
  timeoutMs?: number;
  waitFor?: string;
  create?: boolean;
}

export interface RunChannelResult {
  spawned: Awaited<ReturnType<typeof spawnChannelWorker>>;
  sent?: ChannelEvent;
  result: ChannelEvent | null;
}

export async function runChannelWorker(
  channelName: string,
  options: RunChannelOptions,
): Promise<RunChannelResult> {
  const pathOptions: ChannelPathOptions = {
    cwd: options.cwd,
    project: options.project,
  };
  if (!fs.existsSync(channelDir(channelName, pathOptions))) {
    await createChannel(channelName, {
      cwd: options.cwd,
      project: options.project,
      task: options.task,
      description: "one-shot channel run",
      by: options.by,
    });
  } else if (options.create === true) {
    throw new Error(`Channel '${channelName}' already exists`);
  }

  const spawned = await spawnChannelWorker(channelName, options);
  const sent =
    options.text !== undefined
      ? await sendChannelMessage(channelName, {
          cwd: options.cwd,
          project: options.project,
          as: options.by ?? "main",
          to: options.as,
          text: options.text,
        })
      : undefined;

  const result = await waitForChannelEvent(channelName, {
    cwd: options.cwd,
    project: options.project,
    as: options.by ?? "main",
    from: options.waitFor ?? options.as,
    kind: "done,error,killed",
    to: options.by ?? "main",
    timeoutMs: options.timeoutMs,
    sinceSeq: sent?.seq,
    fromStart: sent === undefined,
  });

  return { spawned, sent, result };
}
