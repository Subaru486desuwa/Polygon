import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendEvent,
  readChannelEvents,
  readLastSeq,
} from "../../../src/commands/channel/events.js";
import { eventsPath } from "../../../src/commands/channel/paths.js";

describe("channel event store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-channel-events-"));
    fs.mkdirSync(path.join(tmpDir, ".polygon"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends events with monotonically increasing seq values", async () => {
    const first = await appendEvent(
      "demo",
      {
        kind: "created",
        by: "main",
        cwd: tmpDir,
        channelType: "chat",
      },
      { cwd: tmpDir, project: "test" },
    );
    const second = await appendEvent(
      "demo",
      {
        kind: "message",
        by: "main",
        text: "hello",
      },
      { cwd: tmpDir, project: "test" },
    );

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(await readLastSeq("demo", { cwd: tmpDir, project: "test" })).toBe(2);
  });

  it("ignores malformed lines when reading existing events", async () => {
    await appendEvent(
      "demo",
      {
        kind: "created",
        by: "main",
        cwd: tmpDir,
        channelType: "chat",
      },
      { cwd: tmpDir, project: "test" },
    );

    fs.appendFileSync(
      eventsPath("demo", { cwd: tmpDir, project: "test" }),
      "not-json\n{\"seq\":\"bad\",\"kind\":\"message\"}\n",
      "utf-8",
    );

    await appendEvent(
      "demo",
      {
        kind: "message",
        by: "main",
        text: "after bad lines",
      },
      { cwd: tmpDir, project: "test" },
    );

    const events = await readChannelEvents("demo", {
      cwd: tmpDir,
      project: "test",
    });
    expect(events.map((event) => event.seq)).toEqual([1, 2]);
    expect(events.map((event) => event.kind)).toEqual(["created", "message"]);
  });
});
