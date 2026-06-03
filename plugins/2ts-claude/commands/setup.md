---
description: Materialize selected 2ts-claude defaults into THIS repo's committed config (CLAUDE.md, .claude/), merging without clobbering existing setup.
argument-hint: "[component,component | all]  (default: safety-hooks, conventions, settings)"
---

Apply durable, committed Claude Code defaults into the current repository using the bundled engine at `${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs`. The engine does all mechanical merging; your job is to drive it and resolve conflicts with the user. **Do not hand-edit `.claude/` or `CLAUDE.md` yourself — always go through the engine** so the manifest stays accurate.

Selection from the user: `$ARGUMENTS` (empty = the default component set).

Follow these steps:

1. **Plan.** Run the engine in plan mode and capture the JSON:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs" --plan --json \
     $([ -n "$ARGUMENTS" ] && echo --components "$ARGUMENTS")
   ```

   (Omit `--components` entirely when `$ARGUMENTS` is empty so the default set is used. Use `--all` only if the user said "all" / "everything".) The engine auto-detects the repo root via `git rev-parse`; if this isn't a git repo, tell the user and stop — durable config only makes sense in a repo they'll commit.

2. **Summarize the plan.** From the JSON `ops`, give the user a concise list of what will be created/merged, grouped by component. Note that nothing has been written yet.

3. **Resolve conflicts.** If `conflicts` is non-empty, present each one and ask the user how to handle it — they each mean "you (or this repo) already have something here":
   - `file:<path>` — a vendored file exists and differs from what we'd write (you customized it, or it predates us).
   - `setting:<key>` — a settings scalar (e.g. `permissions.defaultMode`) already has a different value.
   - `claudemd:<id>` — the managed CLAUDE.md block was edited by hand since we last wrote it.

   For each, offer **skip** (keep their version — the safe default) or **overwrite** (replace with ours). Offer to show the diff first when useful. Build a resolutions object `{ "<conflictKey>": "overwrite" | "skip" }`.

4. **Apply.** Write the resolutions to a temp file and run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs" --apply --resolutions /tmp/2ts-resolutions.json \
     $([ -n "$ARGUMENTS" ] && echo --components "$ARGUMENTS")
   ```

   (If there were no conflicts, you can skip the `--resolutions` flag.) Unspecified conflicts default to skip; never pass `--force` unless the user explicitly asked to overwrite everything.

5. **Report and remind.** Summarize what changed. Then remind the user: these changes are **durable only once committed** — show `git status`/`git diff` of `CLAUDE.md` and `.claude/`, and suggest they review and commit so teammates pick them up on their next clone/pull. Mention that re-running `/setup` later is safe and idempotent, and that `apply.cjs --remove` cleanly reverses what was added.

Available components (for reference when the user asks what they can pick): `safety-hooks`, `conventions`, `settings` (defaults), `workflow-hooks`, `notify-hook`, `statusline`, `mcp`, `agents`, `skill-code-standards`, `command-handoff`. The first three are the default set.
