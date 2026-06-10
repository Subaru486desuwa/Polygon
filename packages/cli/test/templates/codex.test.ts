import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllAgents,
  getAllCodexSkills,
  getConfigTemplate,
} from "../../src/templates/codex/index.js";
import { resolveAllAsSkills } from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const EXPECTED_AGENT_NAMES = [
  "polygon-check",
  "polygon-implement",
  "polygon-research",
];

// Shared skills are now sourced from common/ via resolveAllAsSkills
describe("codex shared skills (from common source)", () => {
  it("resolves all common templates for codex context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    for (const skill of skills) {
      // Codex uses $ prefix, not /polygon:
      expect(skill.content).not.toContain("/polygon:");
      expect(skill.content).not.toContain(".claude/");
      expect(skill.content).not.toContain(".cursor/");
    }
  });
});

describe("codex getAllAgents", () => {
  it("returns the expected custom agent set", () => {
    const agents = getAllAgents();
    const names = agents.map((agent) => agent.name);
    expect(names).toEqual(EXPECTED_AGENT_NAMES);
  });

  it("each agent has required fields (name, description, developer_instructions)", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content.length).toBeGreaterThan(0);
      expect(agent.content).toContain("name = ");
      expect(agent.content).toContain("description = ");
      expect(agent.content).toContain("developer_instructions = ");
    }
  });
});

describe("codex getAllCodexSkills (platform-specific)", () => {
  it("returns empty after parallel removal", () => {
    const skills = getAllCodexSkills();
    expect(skills).toEqual([]);
  });
});

describe("codex getConfigTemplate", () => {
  it("returns project config.toml content", () => {
    const config = getConfigTemplate();
    expect(config.targetPath).toBe("config.toml");
    expect(config.content).toContain("project_doc_fallback_filenames");
    expect(config.content).toContain("AGENTS.md");
  });

  // The structured [features.multi_agent_v2] table form is only accepted by
  // Codex CLI 0.131+. On 0.130 and earlier — including the codex CLI bundled
  // in the Codex desktop app — it aborts the whole config load with
  // `data did not match any variant of untagged enum FeatureToml`. Polygon
  // no longer writes the block; this test guards against reintroducing it.
  it("does not write a [features.multi_agent_v2] block (Codex 0.130 compat)", () => {
    const config = getConfigTemplate();
    expect(config.content).not.toMatch(/^\[features\.multi_agent_v2\]/m);
  });
});

// =============================================================================
// Issue #234 — Codex sub-agent recursion guard
// =============================================================================
//
// polygon-implement / polygon-check agent toml MUST contain a hard recursion
// guard that tells the sub-agent it is already the dispatched agent and must
// not spawn another polygon-implement / polygon-check sub-agent. Without this,
// SessionStart's "dispatch polygon-implement" guidance leaks into sub-agent
// sessions and causes infinite recursion (see PRD).
describe("codex sub-agent recursion guard (issue #234)", () => {
  for (const name of ["polygon-implement", "polygon-check"] as const) {
    it(`${name}.toml developer_instructions forbids spawning polygon-implement / polygon-check`, () => {
      const tomlPath = path.join(
        repoRoot,
        "packages/cli/src/templates/codex/agents",
        `${name}.toml`,
      );
      const content = fs.readFileSync(tomlPath, "utf-8");
      // Hard prohibition keyword
      expect(content).toMatch(/MUST NOT spawn/i);
      // Mentions both sibling agent kinds explicitly
      expect(content).toContain("polygon-implement");
      expect(content).toContain("polygon-check");
      // Mentions the leakage source so the reader knows why
      expect(content).toMatch(/SessionStart|dispatch.*main session|breadcrumb/i);
    });
  }
});

// A-soft (slim rewrite): the recursion risk came from READY-state guidance
// MANDATING sub-agent dispatch. The slim contract removed the mandate, so
// the self-exemption clause lives in the workflow.md breadcrumb and the
// codex agent role files instead. Pin the mandate's absence; the
// SUB_AGENT_NOTICE prefix still tells spawned sub-agents to ignore the
// workflow guidance entirely.
describe("codex session-start.py sub-agent self-exemption (A-soft)", () => {
  const hookPath = path.join(
    repoRoot,
    "packages/cli/src/templates/codex/hooks/session-start.py",
  );

  it("READY-state guidance does not mandate dispatch; sub-agent notice stays", () => {
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).not.toContain("Next required action: dispatch");
    expect(content).not.toContain(
      "default is to NOT edit code in the main session",
    );
    expect(content).toContain("SUB-AGENT NOTICE");
    expect(content).toContain("continue implementation in the main session");
  });
});
