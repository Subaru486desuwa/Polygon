import { describe, expect, it } from "vitest";

import {
  buildAgentProviderConfig,
  buildProviderSpawnSpec,
  buildShellProviderConfig,
  buildWorkerPrompt,
} from "../../../src/commands/channel/providers.js";

describe("channel provider adapters", () => {
  it("keeps shell providers as explicit command invocations", () => {
    const config = buildShellProviderConfig("node", "-e,process.exit(0)", true);

    expect(buildProviderSpawnSpec(config, "ignored")).toEqual({
      command: "node",
      args: ["-e", "process.exit(0)"],
      stdin: true,
    });
  });

  it("builds Claude and Codex provider commands with stdin prompt delivery", () => {
    const claude = buildAgentProviderConfig("claude", undefined, undefined);
    const codex = buildAgentProviderConfig(
      "codex",
      "node",
      "-e,process.stdin.pipe(process.stdout)",
      undefined,
    );

    expect(buildProviderSpawnSpec(claude, "prompt")).toEqual({
      command: "claude",
      args: [],
      stdin: true,
      initialInput: "prompt",
    });
    expect(buildProviderSpawnSpec(codex, "prompt")).toEqual({
      command: "node",
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      stdin: true,
      initialInput: "prompt",
    });
  });

  it("renders channel protocol before loaded context", () => {
    const prompt = buildWorkerPrompt({
      channel: "demo\nchannel",
      worker: "checker\tone",
      project: "test",
      task: ".polygon/tasks/01-demo",
      contextText: "# Channel Context\n\n=== prd.md ===\nbody\n",
    });

    expect(prompt).toContain("worker 'checker one' in channel 'demo channel'");
    expect(prompt).toContain("Do not spawn additional workers");
    expect(prompt).toContain("Do not run git commit, push, merge");
    expect(prompt).toContain("=== prd.md ===\nbody");
  });
});
