# Add Project-Local Conventions

Often the user does not need to change Polygon mechanics; they need local AI to understand their team's conventions. In that case, prefer `.polygon/spec/` or a project-local skill instead of editing `polygon-meta`.

## Where To Put Things

| Content type | Location |
| --- | --- |
| Rules code must follow | `.polygon/spec/<layer>/` |
| Cross-layer thinking methods | `.polygon/spec/guides/` |
| AI capability for a project-specific flow | Platform-local skill |
| One-off task material | `.polygon/tasks/<task>/` |
| Session summary | `.polygon/workspace/<developer>/journal-N.md` |

## Create A Project-Local Skill

If the user wants AI to know "how this project customizes Polygon," create a local skill:

```text
.claude/skills/polygon-local/
└── SKILL.md
```

Example:

```md
---
name: polygon-local
description: "Project-local Polygon customizations for this repository. Use when changing this project's Polygon workflow, hooks, local agents, or team-specific conventions."
---

# Polygon Local

## Local Scope

This skill documents this repository's Polygon customizations only.

## Custom Workflow Rules

- ...

## Local Hook Changes

- ...

## Local Agent Changes

- ...
```

For multi-platform projects, place equivalent versions in other platform skill directories, or use `.agents/skills/` for platforms that support the shared layer.

## Write To `.polygon/spec/`

If the content is a coding convention, write it to spec. Examples:

```text
.polygon/spec/backend/error-handling.md
.polygon/spec/frontend/components.md
.polygon/spec/guides/cross-platform-thinking-guide.md
```

After writing it, update the corresponding `index.md` so AI can find the new rule from the entry point.

## Make The Current Task Use New Conventions

After writing a spec, add it to the current task context:

```bash
python3 ./.polygon/scripts/task.py add-context <task> implement ".polygon/spec/backend/error-handling.md" "Error handling conventions"
python3 ./.polygon/scripts/task.py add-context <task> check ".polygon/spec/backend/error-handling.md" "Review error handling"
```

## Do Not Store Project-Private Rules In `polygon-meta`

`polygon-meta` is a public skill for understanding Polygon architecture and local customization entry points. Put project-private content in:

- `.polygon/spec/`
- a project-local skill
- the current task
- workspace journal

This prevents future updates to Polygon's built-in `polygon-meta` from overwriting the team's own conventions.
