# 2ts-claude

![CI](https://github.com/elliottsencan/2ts-claude/actions/workflows/ci.yml/badge.svg)
[![Built with Claude Code](https://img.shields.io/badge/built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

My personal [Claude Code](https://claude.com/claude-code) toolkit, packaged as a plugin.

It works in two modes:

1. **Distribute it once** — install the plugin to get the `/setup` command (and the toolkit's agents/skills) in your sessions.
2. **Stamp durable defaults into a repo** — run `/setup` in any repo to merge sensible defaults into that repo's **committed** `CLAUDE.md` and `.claude/`, so they version-control and reach your teammates.

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
/setup                          # default set: safety-hooks, conventions, settings
/setup all                      # everything
/setup statusline,agents,mcp    # pick specific components
```

`/setup` shows a plan, asks you about any conflicts (it never silently overwrites your work), applies the changes, then reminds you to commit. Works the same on a brand-new repo or one with mature Claude infrastructure. Re-running is safe and idempotent.

Under the hood it calls a deterministic engine, which you can also run directly:

```bash
node plugins/2ts-claude/scripts/apply.cjs --plan --all      # preview, no writes
node plugins/2ts-claude/scripts/apply.cjs --apply            # default components
node plugins/2ts-claude/scripts/apply.cjs --remove           # reverse what was added
```

### How merges stay non-destructive

- **CLAUDE.md** — content goes in a marker-delimited block (`<!-- BEGIN 2ts-claude:… -->`). Your prose outside it is never touched.
- **`.claude/settings.json`** — `permissions.allow`/`deny` are set-unioned; scalar defaults are set only if absent (a different existing value becomes a conflict you decide); hook entries are added only if not already present.
- **Vendored files** (hooks/agents/skills/commands) — copied into `.claude/` and hashed in a manifest (`.claude/.2ts-claude.json`). If you later edit one, a re-run flags it as a conflict instead of overwriting.

## Components

| Component | Default | What it adds |
|---|---|---|
| `safety-hooks` | ✅ | `block-dangerous-commands`, `protect-secrets` (PreToolUse) |
| `conventions` | ✅ | Coding conventions block in `CLAUDE.md` |
| `settings` | ✅ | Permission allow-list defaults |
| `workflow-hooks` | | `format-on-edit` (Prettier), `auto-stage` (git add) |
| `notify-hook` | | Slack message on permission prompts (`CCH_SLA_WEBHOOK`) |
| `statusline` | | Status line: model, branch, context-usage bar |
| `mcp` | | `context7` and `playwright` MCP servers |
| `agents` | | `code-reviewer`, `bug-hunter` subagents |
| `skill-code-standards` | | `code-standards` skill |
| `command-handoff` | | `/handoff` command |

## Personal global config

`templates/settings.json` is a separate artifact — a starting point for your *own* `~/.claude` config (default plan mode, enabled plugins, status line). `scripts/install.sh` / `sync.sh` install and update the plugin into your user config. These are distinct from the per-repo `/setup` flow above.

## Tests

```bash
npm test
```
