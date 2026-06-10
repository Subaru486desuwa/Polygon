# Break the Loop — Post-Fix Analysis

Use after fixing a bug that took multiple attempts, or that you've fixed before. The value of debugging is not the fix — it's making this class of bug unable to recur.

Work through five questions (prose is fine; no template to fill):

1. **Root cause category** — missing spec / unclear cross-layer contract / change didn't propagate to all sites / test coverage gap / implicit assumption. Naming the category tells you where the prevention lives.
2. **Why earlier fixes failed** (if they did) — surface fix of a symptom? incomplete scope? tool limitation (grep missed it, types too loose)? wrong mental model (kept looking in one layer)?
3. **Prevention mechanism** — prefer structural over procedural: make the error impossible (types, architecture) > catch at compile/test time > document a checklist item. Pick the strongest one that's proportionate.
4. **Systematic expansion** — where else does this same pattern exist right now? Check before closing.
5. **Capture** — actually update `.polygon/spec/` (the `update-spec` skill has the format). A list of TODOs is not capture; the edited spec file is.
