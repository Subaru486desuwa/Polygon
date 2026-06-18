import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadChannelContext,
  renderChannelContext,
} from "../../../src/commands/channel/context.js";

describe("channel context loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-channel-context-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relativePath: string, content: string): string {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    return fullPath;
  }

  it("loads direct file paths as repo-relative context entries", async () => {
    write("docs/guide.md", "# Guide\n");

    const result = await loadChannelContext({
      cwd: tmpDir,
      files: ["docs/guide.md"],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: "docs/guide.md",
      content: "# Guide\n",
      source: "file",
    });
    expect(result.totalBytes).toBe(Buffer.byteLength("# Guide\n"));
    expect(result.warnings).toEqual([]);
  });

  it("streams JSONL manifests, skips seed rows, and preserves reasons", async () => {
    write("spec/a.md", "A");
    write("spec/b.md", "B");
    write(
      "ctx/implement.jsonl",
      [
        JSON.stringify({ _example: "seed row" }),
        JSON.stringify({ file: "spec/a.md", reason: "alpha" }),
        "",
        JSON.stringify({ file: "spec/b.md", reason: "beta" }),
      ].join("\n"),
    );

    const result = await loadChannelContext({
      cwd: tmpDir,
      jsonl: ["ctx/implement.jsonl"],
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "spec/a.md",
      "spec/b.md",
    ]);
    expect(result.files.map((file) => file.reason)).toEqual(["alpha", "beta"]);
    expect(result.files.map((file) => file.manifestLine)).toEqual([2, 4]);
  });

  it("rejects path escapes before reading files", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-outside-"));
    write("inside.md", "inside");
    fs.writeFileSync(path.join(outside, "secret.md"), "secret", "utf-8");

    try {
      await expect(
        loadChannelContext({
          cwd: tmpDir,
          files: [path.join(outside, "secret.md")],
        }),
      ).rejects.toThrow("Context path escapes worker cwd");

      await expect(
        loadChannelContext({
          cwd: tmpDir,
          files: ["../secret.md"],
        }),
      ).rejects.toThrow("Context path escapes worker cwd");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects symlinks that resolve outside the worker cwd", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "polygon-outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "secret", "utf-8");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(tmpDir, "link.md"));

    try {
      await expect(
        loadChannelContext({
          cwd: tmpDir,
          files: ["link.md"],
        }),
      ).rejects.toThrow("Context path escapes worker cwd");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("skips files over the hard size cap with a warning", async () => {
    write("big.txt", "abcdef");

    const result = await loadChannelContext({
      cwd: tmpDir,
      files: ["big.txt"],
      maxFileBytes: 5,
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "file_too_large",
        path: "big.txt",
      }),
    ]);
  });

  it("expands directories and globs deterministically", async () => {
    write("notes/b.md", "B");
    write("notes/a.md", "A");
    write("notes/c.txt", "C");

    const fromDirectory = await loadChannelContext({
      cwd: tmpDir,
      files: ["notes"],
    });
    expect(fromDirectory.files.map((file) => file.path)).toEqual([
      "notes/a.md",
      "notes/b.md",
      "notes/c.txt",
    ]);

    const fromGlob = await loadChannelContext({
      cwd: tmpDir,
      files: ["notes/*.md"],
    });
    expect(fromGlob.files.map((file) => file.path)).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);
  });

  it("deduplicates the same real file across file and JSONL sources", async () => {
    write("spec/demo.md", "demo");
    write(
      "implement.jsonl",
      JSON.stringify({ file: "spec/demo.md", reason: "manifest" }) + "\n",
    );

    const result = await loadChannelContext({
      cwd: tmpDir,
      files: ["spec/demo.md"],
      jsonl: ["implement.jsonl"],
    });

    expect(result.files.map((file) => file.path)).toEqual(["spec/demo.md"]);
    expect(result.files[0]?.source).toBe("file");
  });

  it("records invalid JSONL lines as warnings without failing the manifest", async () => {
    write("spec/demo.md", "demo");
    write(
      "implement.jsonl",
      [
        "not-json",
        JSON.stringify({ file: 42 }),
        JSON.stringify({ file: "spec/demo.md" }),
      ].join("\n"),
    );

    const result = await loadChannelContext({
      cwd: tmpDir,
      jsonl: ["implement.jsonl"],
    });

    expect(result.files.map((file) => file.path)).toEqual(["spec/demo.md"]);
    expect(result.warnings.map((item) => item.code)).toEqual([
      "invalid_jsonl",
      "invalid_jsonl",
    ]);
  });

  it("sanitizes rendered context headers", async () => {
    write("spec/demo.md", "body");
    write(
      "implement.jsonl",
      JSON.stringify({
        file: "spec/demo.md",
        reason: "reason\nwith\tcontrol",
      }) + "\n",
    );

    const result = await loadChannelContext({
      cwd: tmpDir,
      jsonl: ["implement.jsonl"],
    });
    const rendered = renderChannelContext(result);

    expect(rendered).toContain("=== spec/demo.md | reason: reason with control ===");
    expect(rendered).toContain("body");
  });
});
