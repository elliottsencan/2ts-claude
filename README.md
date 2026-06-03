# 2ts-claude

![CI](https://github.com/elliottsencan/2ts-claude/actions/workflows/ci.yml/badge.svg)
[![Built with Claude Code](https://img.shields.io/badge/built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

My personal [Claude Code](https://claude.com/claude-code) toolkit, packaged as a plugin.

It works in two modes:

1. **Distribute it once** — install the plugin to get the `/setup` command in your sessions.
2. **Stamp durable defaults into a repo** — run `/setup` in any repo to merge sensible defaults into that repo's **committed** `CLAUDE.md` and `.claude/`, so they version-control and reach your teammates.

The plugin is a *delivery vehicle*: its only ambient surface is the operator controls (`/setup`, `/research-refresh`, and a drift-reminder hook). The agents, skills, and commands it ships are vendor templates under `assets/` — they reach a repo only by being vendored through `/setup`, never just because the plugin is installed.

A plugin can't write into a repo itself (its files live isolated in `~/.claude/plugins/cache/`). What it *can* do is ship the `/setup` command that does the durable writes — selectively, and without clobbering setup you already have.

## Install the plugin

```bash
claude plugin marketplace add elliottsencan/2ts-claude
claude plugin install 2ts-claude@2ts-claude
```

Update later:

```bash
claude plugin marketplace update 2ts-claude
claude plugin update 2ts-claude@2ts-claude
```

## Stamp defaults into a repo

In the repo you want to configure:

```
/setup                          # show the component menu and pick interactively
/setup all                      # everything, no menu
/setup statusline,agents,mcp    # name components directly, no menu
```

Run bare, `/setup` lists every available component (defaults marked) and lets you choose — take the defaults, add extras on top, pick an exact set, or take everything. Pass component names (or `all`) to skip the menu. Either way it then shows a plan, asks you about any conflicts (it never silently overwrites your work), applies the changes, then reminds you to commit. Works the same on a brand-new repo or one with mature Claude infrastructure. Re-running is safe and idempotent.

The menu is generated from the engine's own catalog (`apply.cjs --list`), so it always matches what's actually shipped:

```bash
node plugins/2ts-claude/scripts/apply.cjs --list          # the component catalog
```

Under the hood it calls a deterministic engine, which you can also run directly:

```bash
node plugins/2ts-claude/scripts/apply.cjs --plan --all      # preview, no writes
node plugins/2ts-claude/scripts/apply.cjs --apply            # default components
node plugins/2ts-claude/scripts/apply.cjs --remove           # reverse what was added
```

### How merges stay non-destructive

- **CLAUDE.md / AGENTS.md** — content goes in a marker-delimited block (`<!-- BEGIN 2ts-claude:… -->`). Your prose outside it is never touched. If the repo already uses `AGENTS.md`, the conventions land there (the cross-tool source of truth) and CLAUDE.md gets an `@AGENTS.md` import instead of a duplicate.
- **`.claude/settings.json`** — `permissions.allow`/`deny` are set-unioned; scalar defaults are set only if absent (a different existing value becomes a conflict you decide); hook entries are added only if not already present.
- **Vendored files** (hooks/agents/skills/commands) — copied into `.claude/` and hashed in a manifest (`.claude/.2ts-claude.json`). If you later edit one, a re-run flags it as a conflict instead of overwriting.

## Components

| Component | Default | What it adds |
|---|---|---|
| `safety-hooks` | ✅ | `block-dangerous-commands`, `protect-secrets` (PreToolUse) |
| `conventions` | ✅ | Coding conventions block in `AGENTS.md` (if present) or `CLAUDE.md`, incl. an untrusted-input rule |
| `settings` | ✅ | Permission allow-list + a narrow secret-file deny-list |
| `workflow-hooks` | | `format-on-edit` (Prettier), `lint-on-edit` (ESLint `--fix`, where configured), `auto-stage` (git add) |
| `notify-hook` | | Slack message on permission prompts (`CCH_SLA_WEBHOOK`) |
| `statusline` | | Status line: model, branch, context-usage bar |
| `mcp` | | `context7` and `playwright` MCP servers |
| `ci-secret-scan` | | gitleaks GitHub Action that scans for committed secrets (CI, no local friction) |
| `editorconfig` | | Portable `.editorconfig` (utf-8, lf, final newline, 2-space) |
| `gitattributes` | | `.gitattributes`: normalize line endings, keep lockfiles out of diffs/language stats |
| `pr-template` | | `.github/pull_request_template.md` (summary, changes, testing, risk/rollback) |
| `dependabot` | | `.github/dependabot.yml`: grouped weekly github-actions + npm updates |
| `release-please` | | Conventional-commit releases: GitHub Action + `release-please-config.json` + manifest (changelog, version bumps, tags) |
| `agents` | | `code-reviewer`, `bug-hunter` subagents |
| `skill-code-standards` | | `code-standards` skill |
| `command-handoff` | | `/handoff` command |
| `command-pr` | | `/pr` command (drafts a copy-ready PR title + body) |
| `command-wiki` | | 🔒 `/wiki` — query your personal reading wiki on demand (reads `$ELLIOTTSENCAN_WIKI_DIR`) |
| `wiki-surface` | | 🔒 quietly surface relevant wiki entries on each prompt, above a confidence threshold |

🔒 = **local scope**: installed just for you (`.claude/settings.local.json` + `.claude/local/`, git-ignored via a managed `.claude/.gitignore`), never committed onto teammates. Everything else is **shared** — merged into the repo's committed `.claude/` so it version-controls and reaches the team.

## Personal global config

`templates/settings.json` is a separate artifact — a starting point for your *own* `~/.claude` config (default plan mode, enabled plugins, status line). `scripts/install.sh` / `sync.sh` install and update the plugin into your user config. These are distinct from the per-repo `/setup` flow above.

### Git helpers

Installed by `scripts/install-git-helpers.sh` (also run by `install.sh` for this repo):

- `git acp` — refuses to run on `main`, then `git add . && git commit && git push` in one shot.
- `git commit` with no message generates one from the staged diff with `claude --model haiku`, via a `prepare-commit-msg` hook. Override the model with `CLAUDE_COMMIT_MODEL`.

The aliases are global. The commit-message hook is per-repo — run `scripts/install-git-helpers.sh` inside each repo where you want it.

### Maintaining the plugin (operator-only)

These run only for whoever has the plugin installed — never for teammates, who just get the durable committed config:

- **Drift reminder** — a `SessionStart` hook that nudges you when something is stale, silent otherwise. Two checks: (1) re-run `/setup` when a repo's stamped config lags your installed plugin; (2) run `claude plugin update` when your installed plugin lags the latest published version. The published check is cached 24h, times out at 1.5s, fails silently, and can be disabled with `CCH_NO_UPDATE_CHECK=1`.
- **`/research-refresh`** — researches current Claude Code best practices and opens a PR proposing updates to the plugin's components. Kept separate from `/setup` so setup stays deterministic; schedule it with `/schedule` if you want it on a cadence.

## Tests

```bash
npm test
```
