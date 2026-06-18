import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createChannel } from "../../../src/commands/channel/create.js";
import { listChannels } from "../../../src/commands/channel/list.js";
import { sendChannelMessage } from "../../../src/commands/channel/send.js";
import {
  parseDuration,
  waitForChannelEvent,
} from "../../../src/commands/channel/wait.js";
import { readChannelEvents } from "../../../src/commands/channel/events.js";

describe("channel commands", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-channel-cmd-"));
    fs.mkdirSync(path.join(tmpDir, ".polygon", "tasks", "01-demo"), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("creates a channel linked to a task", async () => {
    const event = await createChannel("demo", {
      cwd: tmpDir,
      project: "test",
      by: "main",
      task: "01-demo",
      labels: "phase1,review",
      description: "first channel",
    });

    expect(event).toMatchObject({
      seq: 1,
      kind: "created",
      by: "main",
      task: ".polygon/tasks/01-demo",
      labels: ["phase1", "review"],
      description: "first channel",
    });
  });

  it("rejects duplicate channel create without force semantics", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    await expect(
      createChannel("demo", { cwd: tmpDir, project: "test" }),
    ).rejects.toThrow("Channel 'demo' already exists");
  });

  it("sends targeted messages", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });
    const event = await sendChannelMessage("demo", {
      cwd: tmpDir,
      project: "test",
      as: "main",
      to: "worker-a,worker-b",
      text: "do work",
    });

    expect(event).toMatchObject({
      seq: 2,
      kind: "message",
      by: "main",
      text: "do work",
      to: ["worker-a", "worker-b"],
    });
  });

  it("rejects send to a missing channel", async () => {
    await expect(
      sendChannelMessage("missing", {
        cwd: tmpDir,
        project: "test",
        as: "main",
        text: "hello",
      }),
    ).rejects.toThrow("Channel 'missing' not found");
  });

  it("lists channels with linked task and last event", async () => {
    await createChannel("demo", {
      cwd: tmpDir,
      project: "test",
      task: "01-demo",
      description: "listed channel",
    });
    await sendChannelMessage("demo", {
      cwd: tmpDir,
      project: "test",
      as: "main",
      text: "hello",
    });

    const entries = await listChannels({ cwd: tmpDir, project: "test" });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "demo",
      project: "test",
      eventCount: 2,
      task: ".polygon/tasks/01-demo",
      title: "listed channel",
    });
    expect(entries[0]?.lastEvent?.kind).toBe("message");
  });

  it("waits from EOF so old matching events do not unblock fresh waits", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });
    await sendChannelMessage("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      to: "main",
      text: "old",
    });

    const waitPromise = waitForChannelEvent("demo", {
      cwd: tmpDir,
      project: "test",
      as: "main",
      from: "worker",
      kind: "message",
      timeoutMs: 2_000,
      pollMs: 10,
    });

    await sendChannelMessage("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      to: "main",
      text: "new",
    });

    const event = await waitPromise;
    expect(event).toMatchObject({
      kind: "message",
      by: "worker",
      text: "new",
    });
  });

  it("wait --all returns after each requested sender has matched", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    const waitPromise = waitForChannelEvent("demo", {
      cwd: tmpDir,
      project: "test",
      as: "main",
      from: "a,b",
      kind: "done",
      all: true,
      timeoutMs: 2_000,
      pollMs: 10,
    });

    await sendChannelMessage("demo", {
      cwd: tmpDir,
      project: "test",
      as: "a",
      to: "main",
      text: "not done",
    });
    const eventsAfterMessage = await readChannelEvents("demo", {
      cwd: tmpDir,
      project: "test",
    });
    expect(eventsAfterMessage.map((event) => event.kind)).toEqual([
      "created",
      "message",
    ]);

    await import("../../../src/commands/channel/events.js").then(
      async ({ appendEvent }) => {
        await appendEvent(
          "demo",
          {
            kind: "done",
            by: "a",
            text: "a done",
            to: "main",
          },
          { cwd: tmpDir, project: "test" },
        );
        await appendEvent(
          "demo",
          {
            kind: "done",
            by: "b",
            text: "b done",
            to: "main",
          },
          { cwd: tmpDir, project: "test" },
        );
      },
    );

    const event = await waitPromise;
    expect(event).toMatchObject({
      kind: "done",
      by: "b",
      text: "b done",
    });
  });

  it("sets exitCode 124 when wait times out", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    const event = await waitForChannelEvent("demo", {
      cwd: tmpDir,
      project: "test",
      as: "main",
      kind: "done",
      timeoutMs: 20,
      pollMs: 5,
    });

    expect(event).toBeNull();
    expect(process.exitCode).toBe(124);
  });

  it("waits from an explicit sequence to avoid send/wait races", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });
    const sent = await sendChannelMessage("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      to: "main",
      text: "already written",
    });

    const event = await waitForChannelEvent("demo", {
      cwd: tmpDir,
      project: "test",
      as: "main",
      from: "worker",
      kind: "message",
      sinceSeq: sent.seq - 1,
      timeoutMs: 20,
      pollMs: 5,
    });

    expect(event).toMatchObject({
      seq: sent.seq,
      text: "already written",
    });
  });

  it("parses durations with explicit units", () => {
    expect(parseDuration("10ms")).toBe(10);
    expect(parseDuration("2s")).toBe(2_000);
    expect(parseDuration("3m")).toBe(180_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration(undefined)).toBeUndefined();
  });
});
