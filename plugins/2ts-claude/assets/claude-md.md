## Conventions

> Bias toward caution over speed on non-trivial work. For trivial tasks (typos, obvious one-liners), use judgment — skip the ceremony.

### Think before coding

- State assumptions explicitly. If uncertain, ask — don't guess or infer intent from partial instructions.
- If multiple interpretations exist, present them; don't pick one silently.
- If a simpler approach exists, say so. Push back when warranted.
- Treat compiler/test output I paste as the source of truth.

### Simplicity first

- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked; no abstractions for single-use code; no "flexibility"/config I didn't request.
- No error handling for impossible scenarios.
- If it's 200 lines and could be 50, rewrite it. Ask: "would a senior engineer call this overcomplicated?" If yes, simplify.

### Surgical changes

- Do what's asked — nothing more. Touch only what you must; every changed line should trace to my request.
- Don't refactor, reformat, or "improve" adjacent code, comments, or style — match what's there even if you'd do it differently.
- Remove only the imports/vars/functions YOUR change orphaned. Notice unrelated dead code? Mention it, don't delete it.
- If a change needs files beyond the obvious scope, STOP and ask first.
- Don't create files (especially docs/`*.md`) unless asked. Prefer editing an existing file.

### Goal-driven execution

- Turn vague tasks into verifiable goals: "fix the bug" → "write a failing test that reproduces it, then make it pass."
- For multi-step work, state a brief plan with a verify step per item before diving in.
- Loop until the success criteria are met — not until "it seems to work."

### Code quality

- Minimize comments; prefer self-documenting names. No commented-out code.
- No secrets in code or commits. Use env vars / a secret manager.

### Tests

- Prefer a small set of high-value test cases over exhaustive "for completeness" coverage.
- Add a regression test when fixing a non-trivial bug.

### Git

- Commit/push only when I ask. Branch before committing if on the default branch.
- Keep commit messages concise and in the imperative mood.

<!-- "Think before coding / Simplicity first / Surgical changes / Goal-driven execution" adapted from Karpathy-inspired guidelines (github.com/multica-ai/andrej-karpathy-skills, MIT). -->
