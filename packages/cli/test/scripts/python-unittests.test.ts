/**
 * Runs the stdlib-unittest suites under `test/python/` against the real
 * template scripts (`src/templates/polygon/scripts`):
 *
 *   - test_activity.py — common.activity (multi-LLM task activity log)
 *   - test_task_activity_commit.py — task.py `activity-commit`, the git
 *     post-commit hook entry (never-disrupt-a-commit contract)
 */

import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const PYTHON_TESTS = path.resolve(__dirname, "../python");

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasPython())("python unit tests (template scripts)", () => {
  it("unittest discover passes", () => {
    // Scrub ambient Polygon/agent env so results don't depend on the shell
    // (a live POLYGON_CONTEXT_ID would feed resolve_context_key).
    const env = { ...process.env };
    delete env.POLYGON_CONTEXT_ID;
    delete env.POLYGON_ACTIVITY_MODEL;
    delete env.AI_AGENT;

    const r = spawnSync(
      "python3",
      ["-m", "unittest", "discover", "-s", PYTHON_TESTS, "-v"],
      { encoding: "utf-8", env },
    );
    expect(r.status, `unittest failed:\n${r.stderr}`).toBe(0);
  });
});
