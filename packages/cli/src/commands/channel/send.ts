import fs from "node:fs";

import { appendEvent } from "./events.js";
import { channelDir } from "./paths.js";
import { parseCsv } from "./schema.js";
import type { ChannelEvent, ChannelPathOptions, ChannelTarget } from "./types.js";

export interface SendChannelOptions extends ChannelPathOptions {
  as: string;
  text?: string;
  stdin?: boolean;
  textFile?: string;
  to?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function resolveText(options: SendChannelOptions): Promise<string> {
  if (options.stdin === true) {
    return readStdin();
  }
  if (options.textFile !== undefined) {
    return fs.readFileSync(options.textFile, "utf-8");
  }
  if (options.text !== undefined) {
    return options.text;
  }
  throw new Error("No text provided (use <text>, --stdin, or --text-file)");
}

function targetFromCsv(value: string | undefined): ChannelTarget | undefined {
  const parsed = parseCsv(value);
  if (parsed === undefined) return undefined;
  return parsed.length === 1 ? parsed[0] : parsed;
}

export async function sendChannelMessage(
  name: string,
  options: SendChannelOptions,
): Promise<ChannelEvent> {
  if (!fs.existsSync(channelDir(name, options))) {
    throw new Error(`Channel '${name}' not found`);
  }
  const text = await resolveText(options);
  if (text.trim().length === 0) {
    throw new Error("Empty message");
  }
  return appendEvent(
    name,
    {
      kind: "message",
      by: options.as,
      text,
      to: targetFromCsv(options.to),
    },
    options,
  );
}
