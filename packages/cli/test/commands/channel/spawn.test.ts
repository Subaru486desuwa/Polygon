import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createChannel } from "../../../src/commands/channel/create.js";
import { appendEvent, readChannelEvents } from "../../../src/commands/channel/events.js";
import { interruptChannelWorker } from "../../../src/commands/channel/interrupt.js";
import { killChannelWorker } from "../../../src/commands/channel/kill.js";
import { listChannels } from "../../../src/commands/channel/list.js";
import { workerDir } from "../../../src/commands/channel/paths.js";
import {
  parseMaxLiveWorkers,
  spawnChannelWorker,
} from "../../../src/commands/channel/spawn.js";
import { runChannelWorker } from "../../../src/commands/channel/run.js";

describe("channel spawn lifecycle", () => {
  let tmpDir: string;
  let supervisorEntrypoint: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-channel-spawn-"));
    fs.mkdirSync(path.join(tmpDir, ".polygon"), { recursive: true });
    supervisorEntrypoint = writeSupervisorEntrypoint();
  });

  afterEach(() => {
    cleanupRuntimeProcesses();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(supervisorEntrypoint), { recursive: true, force: true });
  });

  function writeSupervisorEntrypoint(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-supervisor-"));
    const entrypoint = path.join(dir, "supervisor.mjs");
    fs.writeFileSync(
      entrypoint,
      [
        'import { spawn } from "node:child_process";',
        'import fs from "node:fs";',
        'import path from "node:path";',
        'const config = JSON.parse(fs.readFileSync(process.argv[4], "utf-8"));',
        'const runtime = path.join(config.cwd, ".polygon", ".runtime", "channels", config.project, config.channel);',
        'const workerDir = path.join(runtime, "workers", config.worker);',
        'const eventsPath = path.join(runtime, "events.jsonl");',
        'const pidPath = path.join(workerDir, "pid");',
        'const workerPidPath = path.join(workerDir, "worker-pid");',
        'const reservationPath = path.join(workerDir, "reservation");',
        'fs.mkdirSync(workerDir, { recursive: true });',
        'function readLastSeq() {',
        '  if (!fs.existsSync(eventsPath)) return 0;',
        '  return fs.readFileSync(eventsPath, "utf-8").split("\\n").reduce((max, line) => {',
        '    if (!line.trim()) return max;',
        '    try { const event = JSON.parse(line); return Math.max(max, typeof event.seq === "number" ? event.seq : 0); }',
        '    catch { return max; }',
        '  }, 0);',
        '}',
        'function append(partial) {',
        '  const event = { ...partial, seq: readLastSeq() + 1, ts: new Date().toISOString() };',
        '  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\\n", "utf-8");',
        '}',
        'function cleanup() {',
        '  for (const file of [pidPath, workerPidPath, reservationPath, path.join(workerDir, "shutdown-reason")]) fs.rmSync(file, { force: true });',
        '}',
        'fs.writeFileSync(pidPath, String(process.pid), "utf-8");',
        'append({ kind: "spawned", by: config.by, as: config.worker, provider: config.provider.provider, pid: process.pid, files: config.contextFiles, manifests: config.contextManifests });',
        'if (config.task) {',
        '  fs.appendFileSync(path.join(config.cwd, config.task, "activity.jsonl"), JSON.stringify({ ts: new Date().toISOString(), platform: "polygon-channel", model: null, session: `${config.project}/${config.channel}`, action: "worker_spawned", note: `worker ${config.worker} spawned` }) + "\\n", "utf-8");',
        '}',
        'const child = spawn(config.provider.command, config.provider.args, { cwd: config.cwd, stdio: "ignore" });',
        'if (child.pid) fs.writeFileSync(workerPidPath, String(child.pid), "utf-8");',
        'let done = false;',
        'function finish(event, code) {',
        '  if (done) return;',
        '  done = true;',
        '  append(event);',
        '  if (config.task) {',
        '    const action = event.kind === "done" ? "worker_completed" : event.kind === "killed" ? "worker_killed" : "worker_failed";',
        '    fs.appendFileSync(path.join(config.cwd, config.task, "activity.jsonl"), JSON.stringify({ ts: new Date().toISOString(), platform: "polygon-channel", model: null, session: `${config.project}/${config.channel}`, action, note: `${config.worker} ${event.kind}` }) + "\\n", "utf-8");',
        '  }',
        '  cleanup();',
        '  process.exit(code);',
        '}',
        'process.once("SIGTERM", () => {',
        '  if (child.pid) { try { process.kill(child.pid, "SIGTERM"); } catch {} }',
        '  finish({ kind: "killed", by: `supervisor:${config.worker}`, to: config.worker, reason: "explicit-kill", signal: "SIGTERM" }, 0);',
        '});',
        'child.once("exit", (code, signal) => {',
        '  if (code === 0) finish({ kind: "done", by: config.worker, text: "worker completed" }, 0);',
        '  else finish({ kind: "error", by: `supervisor:${config.worker}`, message: signal ? `worker exited by signal ${signal}` : `worker exited with code ${code ?? "unknown"}`, provider: config.provider.provider }, 1);',
        '});',
      ].join("\n"),
      "utf-8",
    );
    return entrypoint;
  }

  function cleanupRuntimeProcesses(): void {
    const runtimeDir = path.join(tmpDir, ".polygon", ".runtime", "channels");
    if (!fs.existsSync(runtimeDir)) return;
    for (const pidFile of findPidFiles(runtimeDir)) {
      const pid = Number(fs.readFileSync(pidFile, "utf-8").trim());
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    }
  }

  function findPidFiles(dir: string): string[] {
    const result: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...findPidFiles(fullPath));
      } else if (entry.name === "pid" || entry.name === "worker-pid") {
        result.push(fullPath);
      }
    }
    return result;
  }

  async function waitForKind(kind: string): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const events = await readChannelEvents("demo", {
        cwd: tmpDir,
        project: "test",
      });
      if (events.some((event) => event.kind === kind)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${kind}`);
  }

  it("spawns a shell worker and records spawned/done events", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });
    const contextPath = path.join(tmpDir, "context.md");
    fs.writeFileSync(contextPath, "context", "utf-8");

    const result = await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,process.exit(0)",
      files: ["context.md"],
      supervisorEntrypoint,
    });

    expect(result.worker).toBe("worker");
    await waitForKind("done");

    const events = await readChannelEvents("demo", {
      cwd: tmpDir,
      project: "test",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "created",
      "spawned",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      kind: "spawned",
      as: "worker",
      provider: "shell",
      files: ["context.md"],
    });
  });

  it("projects linked worker milestones into task activity", async () => {
    fs.mkdirSync(path.join(tmpDir, ".polygon", "tasks", "01-demo"), {
      recursive: true,
    });
    await createChannel("demo", {
      cwd: tmpDir,
      project: "test",
      task: "01-demo",
    });

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      task: "01-demo",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,process.exit(0)",
      supervisorEntrypoint,
    });
    await waitForKind("done");

    const activityPath = path.join(
      tmpDir,
      ".polygon",
      "tasks",
      "01-demo",
      "activity.jsonl",
    );
    const actions = fs
      .readFileSync(activityPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string })
      .map((record) => record.action);
    expect(actions).toEqual([
      "channel_created",
      "worker_spawned",
      "worker_completed",
    ]);
  });

  it("inherits task activity linkage from the channel create event", async () => {
    fs.mkdirSync(path.join(tmpDir, ".polygon", "tasks", "01-demo"), {
      recursive: true,
    });
    await createChannel("demo", {
      cwd: tmpDir,
      project: "test",
      task: "01-demo",
    });

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,process.exit(0)",
      supervisorEntrypoint,
    });
    await waitForKind("done");

    const activityPath = path.join(
      tmpDir,
      ".polygon",
      "tasks",
      "01-demo",
      "activity.jsonl",
    );
    const actions = fs
      .readFileSync(activityPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string })
      .map((record) => record.action);
    expect(actions).toEqual([
      "channel_created",
      "worker_spawned",
      "worker_completed",
    ]);
  });

  it("rejects duplicate live worker spawns under the same name", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,setTimeout(() => {}, 5000)",
      supervisorEntrypoint,
    });
    await waitForKind("spawned");

    await expect(
      spawnChannelWorker("demo", {
        cwd: tmpDir,
        project: "test",
        as: "worker",
        provider: "shell",
        command: process.execPath,
        args: "-e,process.exit(0)",
        supervisorEntrypoint,
      }),
    ).rejects.toThrow("already running");

    await killChannelWorker("demo", "worker", { cwd: tmpDir, project: "test" });
    await waitForKind("killed");
  });

  it("enforces the project live-worker budget", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker-a",
      provider: "shell",
      command: process.execPath,
      args: "-e,setTimeout(() => {}, 5000)",
      maxLiveWorkers: 1,
      supervisorEntrypoint,
    });
    await waitForKind("spawned");

    await expect(
      spawnChannelWorker("demo", {
        cwd: tmpDir,
        project: "test",
        as: "worker-b",
        provider: "shell",
        command: process.execPath,
        args: "-e,process.exit(0)",
        maxLiveWorkers: 1,
        supervisorEntrypoint,
      }),
    ).rejects.toThrow("worker budget exceeded");

    await killChannelWorker("demo", "worker-a", {
      cwd: tmpDir,
      project: "test",
    });
    await waitForKind("killed");
  });

  it("lists active workers from runtime pid state", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,setTimeout(() => {}, 5000)",
      supervisorEntrypoint,
    });
    await waitForKind("spawned");

    const entries = await listChannels({ cwd: tmpDir, project: "test" });
    expect(entries[0]?.workers).toEqual([
      expect.objectContaining({
        channel: "demo",
        worker: "worker",
        alive: true,
      }),
    ]);

    await killChannelWorker("demo", "worker", { cwd: tmpDir, project: "test" });
    await waitForKind("killed");
  });

  it("omits completed workers from channel list worker summary", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,process.exit(0)",
      supervisorEntrypoint,
    });
    await waitForKind("done");

    const entries = await listChannels({ cwd: tmpDir, project: "test" });
    expect(entries[0]?.workers).toEqual([]);
  });

  it("cleans stale worker pid files before respawn", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });
    const staleDir = workerDir("demo", "worker", { cwd: tmpDir, project: "test" });
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, "pid"), "99999999", "utf-8");
    await appendEvent(
      "demo",
      {
        kind: "killed",
        by: "main",
        to: "worker",
        reason: "stale-test",
      },
      { cwd: tmpDir, project: "test" },
    );

    await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,process.exit(0)",
      supervisorEntrypoint,
    });
    await waitForKind("done");

    const events = await readChannelEvents("demo", {
      cwd: tmpDir,
      project: "test",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "created",
      "killed",
      "spawned",
      "done",
    ]);
  });

  it("records interrupt requests for inactive workers", async () => {
    await createChannel("demo", { cwd: tmpDir, project: "test" });

    await interruptChannelWorker("demo", "worker", {
      cwd: tmpDir,
      project: "test",
      by: "main",
      reason: "stop",
    });

    const events = await readChannelEvents("demo", {
      cwd: tmpDir,
      project: "test",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "created",
      "interrupt_requested",
      "interrupted",
    ]);
    expect(events[2]).toMatchObject({
      kind: "interrupted",
      outcome: "no-active-worker",
    });
  });

  it("runs a one-shot worker and waits for a terminal event", async () => {
    const result = await runChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      as: "worker",
      provider: "shell",
      command: process.execPath,
      args: "-e,process.exit(0)",
      timeoutMs: 2_000,
      supervisorEntrypoint,
    });

    expect(result.result).toMatchObject({
      kind: "done",
      by: "worker",
    });
    const events = await readChannelEvents("demo", {
      cwd: tmpDir,
      project: "test",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "created",
      "spawned",
      "done",
    ]);
  });

  it("builds executable agent provider config with channel context prompt", async () => {
    fs.mkdirSync(path.join(tmpDir, ".polygon", "tasks", "01-demo"), {
      recursive: true,
    });
    await createChannel("demo", {
      cwd: tmpDir,
      project: "test",
      task: "01-demo",
    });
    fs.writeFileSync(path.join(tmpDir, "guide.md"), "Use the channel", "utf-8");

    const result = await spawnChannelWorker("demo", {
      cwd: tmpDir,
      project: "test",
      task: "01-demo",
      as: "agent",
      provider: "codex",
      command: process.execPath,
      args: "-e,process.stdin.resume()",
      files: ["guide.md"],
      supervisorEntrypoint,
    });

    const config = JSON.parse(
      fs.readFileSync(result.configPath, "utf-8"),
    ) as {
      provider: { provider: string; command: string; args: string[]; stdin: boolean };
      prompt: string;
      contextFiles: string[];
      task: string;
    };

    expect(config.provider).toEqual({
      provider: "codex",
      command: process.execPath,
      args: ["-e", "process.stdin.resume()"],
      stdin: true,
    });
    expect(config.prompt).toContain("You are worker 'agent' in channel 'demo'.");
    expect(config.prompt).toContain("Do not run git commit, push, merge");
    expect(config.prompt).toContain("=== guide.md ===\nUse the channel");
    expect(config.contextFiles).toEqual(["guide.md"]);
    expect(config.task).toBe(".polygon/tasks/01-demo");

    await killChannelWorker("demo", "agent", { cwd: tmpDir, project: "test" });
    await waitForKind("killed");
  });

  it("parses max live worker counts strictly", () => {
    expect(parseMaxLiveWorkers(undefined)).toBeUndefined();
    expect(parseMaxLiveWorkers("0")).toBe(0);
    expect(parseMaxLiveWorkers("6")).toBe(6);
    expect(() => parseMaxLiveWorkers("1.5")).toThrow("non-negative integer");
    expect(() => parseMaxLiveWorkers("-1")).toThrow("non-negative integer");
    expect(() => parseMaxLiveWorkers("abc")).toThrow("non-negative integer");
  });
});
