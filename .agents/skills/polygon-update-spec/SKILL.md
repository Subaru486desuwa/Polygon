---
name: polygon-update-spec
description: "Captures executable contracts and coding conventions into .polygon/spec/ documents. Use when learning something valuable from debugging, implementing, or discussion that should be preserved for future sessions."
---

# Update Spec — Capture What You Learned

When a task surfaces knowledge worth keeping, write it into `.polygon/spec/` so future sessions don't relearn it. Nothing new? Skip this skill entirely.

## What's worth capturing

| Trigger | Target |
|---------|--------|
| New/changed command, API, or cross-layer contract | relevant `<layer>/*.md` — concrete signatures, payload fields, error behavior |
| Design decision (chose X over Y, and why) | relevant spec, "Design Decisions" section |
| Bug whose class can recur | relevant spec ("Common Mistakes") or `guides/` checklist item |
| New convention or reusable pattern | relevant spec with a code example |

## Spec vs guide

- `.polygon/spec/<layer>/*.md` — **how to implement safely**: signatures, contracts, testable error behavior. Concrete over principled; an executable contract beats a paragraph of philosophy.
- `.polygon/spec/guides/*.md` — **what to think about before writing**: short checklists that point to specs, never duplicating their detail.

Decision rule: "how to write the code" → layer spec; "what to consider first" → guides.

## Process

1. Name the learning precisely: what, why it matters, which file it belongs in (read that file's existing structure first; extend, don't restructure).
2. Write it with at least one concrete example — a signature, a wrong-vs-correct pair, or a failing input. Avoid prose-only rules nobody can test.
3. Keep `index.md` of the touched layer pointing at the file.

The update is the deliverable — analysis left in chat is lost on compaction.
