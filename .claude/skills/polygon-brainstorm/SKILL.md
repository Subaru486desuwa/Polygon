---
name: polygon-brainstorm
description: "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, and converges on MVP scope. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task."
---

# Brainstorm — Requirements Discovery

Turn a vague request into a prd.md the implementation can run on. Depth scales with ambiguity: a clear two-file change needs one confirming question; an open-ended feature needs research and option comparison.

## Principles

1. **Task-first** — make sure a task exists before Q&A so ideas land in files, not chat: `python3 ./.polygon/scripts/task.py create "<short goal>" --slug <name>` (no date prefix in the slug). Seed `prd.md` immediately with what you already know.
2. **Action before asking** — if the answer is derivable from repo code, configs, docs, or quick research, fetch it yourself and write it into the PRD. Ask the user only **blocking** questions (can't proceed without them) and **preference** questions (multiple valid choices). Never ask meta questions ("should I search?", "can you paste the code?").
3. **Options over open questions** — for preference decisions, research first, then present 2–3 concrete approaches with trade-offs and a recommendation. Don't ask the user to invent options.
4. **Persist research** — findings go to `{TASK_DIR}/research/<topic>.md`, one file per topic; the PRD references them instead of duplicating content. Research inline or via `polygon-research` sub-agents (parallelize independent topics) — either way, files are the contract.
5. **Converge to MVP** — before finishing, check future evolution / adjacent scenarios / failure & edge cases once, and make `Out of Scope` explicit. Don't gold-plate.
6. **Update the PRD as answers land** — answered questions move from `Open Questions` into `Requirements` / `Acceptance Criteria` right away.

## PRD skeleton

```markdown
# <Task Title>

## Goal
<what + why, one paragraph>

## Requirements
* ...

## Acceptance Criteria
* [ ] <testable criterion>

## Decision (ADR-lite)        <!-- when an approach was chosen -->
Context / Decision / Consequences

## Out of Scope
* ...

## Research References        <!-- when research happened -->
* `research/<topic>.md` — <one-line takeaway>

## Technical Notes
<constraints, files inspected, links>
```

## Done when

- The user has confirmed goal, requirements, and out-of-scope.
- Open questions are resolved or explicitly deferred.
- Then: curate jsonl only if Phase 2 will dispatch sub-agents, and run `task.py start <task-dir>`.

## Anti-patterns

- Asking for anything derivable from the repo
- Asking the user to choose before showing concrete options
- Leaving research only in the chat (compaction eats it)
- Letting the PRD lag behind the conversation
