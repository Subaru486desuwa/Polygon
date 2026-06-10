# Local Customization Overview

This directory is for local AI working in a user project where Polygon was installed through npm and `polygon init` has already been run. The AI should modify generated `.polygon/` and platform directories inside the project, not Polygon CLI upstream source code.

## First Determine What The User Actually Wants To Change

| User wording | Read first |
| --- | --- |
| "Change the Polygon flow / phases / next prompt" | `change-workflow.md` |
| "Change task creation, status, archive, or hooks" | `change-task-lifecycle.md` |
| "AI did not read context / change injected content" | `change-context-loading.md` |
| "A platform hook is not behaving as expected" | `change-hooks.md` |
| "Change implement/check/research agent behavior" | `change-agents.md` |
| "Add a skill/command/workflow/prompt" | `change-skills-or-commands.md` |
| "Adjust the project spec structure" | `change-spec-structure.md` |
| "Add team conventions and local notes" | `add-project-local-conventions.md` |

## General Operation Order

1. **Confirm platform and directories**: inspect which directories exist, such as `.claude/`, `.codex/`, `.cursor/`.
2. **Confirm the current active task**: run `python3 ./.polygon/scripts/task.py current --source`.
3. **Read the local source of truth**: prefer `.polygon/workflow.md`, `.polygon/config.yaml`, and relevant platform files.
4. **Modify narrowly**: edit only files related to the user's request.
5. **Synchronize semantics**: if a shared flow changes, check whether platform entry points also need changes; if a platform entry changes, check whether `.polygon/workflow.md` still agrees.

## Local File Priority

| Layer | Files |
| --- | --- |
| Workflow | `.polygon/workflow.md` |
| Project configuration | `.polygon/config.yaml` |
| Task material | `.polygon/tasks/<task>/` |
| Project specs | `.polygon/spec/` |
| Runtime scripts | `.polygon/scripts/` |
| Platform integration | `.claude/`, `.codex/`, `.cursor/`, `.opencode/`, and similar directories |
| Shared skill | `.agents/skills/` |

## Things Not To Do By Default

- Do not edit the global npm install directory.
- Do not edit `node_modules/@subaru486/polygon`.
- Do not assume the user has the Polygon GitHub repository.
- Do not overwrite local files already modified by the user with default templates.
- Do not put team project rules into public `polygon-meta`; project rules belong in `.polygon/spec/` or a local skill.

## When To Inspect Upstream Source

Switch to an upstream source-code perspective only when the user explicitly expresses one of these goals:

- "I want to open a PR to Polygon"
- "I want to change npm package publish contents"
- "I want to fork Polygon"
- "I want to modify the generation logic for `polygon init/update`"

Otherwise, default to modifying local Polygon files inside the user project.
