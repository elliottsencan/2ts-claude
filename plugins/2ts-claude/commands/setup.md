---
description: Materialize selected 2ts-claude defaults into THIS repo's committed config (CLAUDE.md, .claude/), merging without clobbering existing setup.
argument-hint: "[component,component | all]  (optional — omit to pick from a menu)"
---

Apply durable, committed Claude Code defaults into the current repository using the bundled engine at `${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs`. The engine does all mechanical merging; your job is to help the user choose components and resolve conflicts. **Do not hand-edit `.claude/` or `CLAUDE.md` yourself — always go through the engine** so the manifest stays accurate.

Selection from the user: `$ARGUMENTS` (may be empty).

Follow these steps:

1. **Decide the selection — interactively when the user didn't name components.**

   - If `$ARGUMENTS` is non-empty, use it as-is (a comma-separated list, or `all`) and skip straight to step 2. This is the power-user path.
   - If `$ARGUMENTS` is empty, **don't silently fall back to the defaults — show the menu and let the user pick.** Read the live catalog (never hardcode it):

     ```
     node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs" --list --json
     ```

     Present the components grouped for easy scanning — the three defaults (`default: true`) first, marked as the baseline; then the other shared components; then any `scope: "local"` ones (flag these as "personal, git-ignored, not committed onto teammates"). Give each its one-line description from the catalog. Then ask the user which to apply, making clear they can:
     - take **just the defaults** (press enter / "defaults"),
     - take the defaults **plus** specific extras (e.g. "defaults + statusline, agents"),
     - pick an **exact** set, or
     - take **everything** ("all").

     Resolve their answer to a concrete component-id list (fold in the defaults unless they explicitly chose a narrower exact set). Use that list as the selection below.

2. **Plan.** Run the engine in plan mode with the resolved selection and capture the JSON:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs" --plan --json --components "<resolved,list>"
   ```

   (Use `--all` instead of `--components` only if the user chose everything. Omit both only if the user explicitly wants the bare default set.) The engine auto-detects the repo root via `git rev-parse`; if this isn't a git repo, tell the user and stop — durable config only makes sense in a repo they'll commit.

3. **Summarize the plan.** From the JSON `ops`, give the user a concise list of what will be created/merged, grouped by component. Note that nothing has been written yet.

4. **Resolve conflicts.** If `conflicts` is non-empty, present each one and ask the user how to handle it — they each mean "you (or this repo) already have something here":
   - `file:<path>` — a vendored file exists and differs from what we'd write (you customized it, or it predates us).
   - `setting:<key>` — a settings scalar (e.g. `permissions.defaultMode`) already has a different value.
   - `conventions:<id>` — the managed conventions block (in CLAUDE.md or AGENTS.md) was edited by hand since we last wrote it.

   For each, offer **skip** (keep their version — the safe default) or **overwrite** (replace with ours). Offer to show the diff first when useful. Build a resolutions object `{ "<conflictKey>": "overwrite" | "skip" }`.

5. **Apply.** Write the resolutions to a temp file and run (reuse the same selection flag from step 2):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.cjs" --apply --resolutions /tmp/2ts-resolutions.json --components "<resolved,list>"
   ```

   (If there were no conflicts, you can skip the `--resolutions` flag.) Unspecified conflicts default to skip; never pass `--force` unless the user explicitly asked to overwrite everything.

6. **Report and remind.** Summarize what changed. **If the apply JSON has a non-empty `notes` object, surface it first** — these are follow-ups the engine can't perform itself (repo settings, env vars, config a component assumes). List them per component as action items before anything else, since the component won't fully work until they're done (e.g. `release-please` needs the GitHub "Allow Actions to create PRs" setting enabled, and its config/manifest assume a Node package at version 0.0.0). Then remind the user: these changes are **durable only once committed** — show `git status`/`git diff` of `CLAUDE.md` and `.claude/`, and suggest they review and commit so teammates pick them up on their next clone/pull. Mention that re-running `/setup` later is safe and idempotent, and that `apply.cjs --remove` cleanly reverses what was added.

The component list is intentionally **not** duplicated here — `--list` is the single source of truth, so the menu always matches what the engine actually ships.
