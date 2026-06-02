# 2ts-claude

My personal [Claude Code](https://claude.com/claude-code) toolkit.

## What's inside

```
plugins/2ts-claude/
├── hooks/            # safety + workflow hooks (bundled, run via ${CLAUDE_PLUGIN_ROOT})
│   ├── pre-tool-use/   block-dangerous-commands, protect-secrets
│   ├── post-tool-use/  format-on-edit, auto-stage
│   ├── notification/   notify-permission (Slack)
│   └── tests/          node --test suite for the hooks
├── agents/           # code-reviewer, bug-hunter
├── skills/           # code-standards
└── commands/         # handoff
templates/            # CLAUDE.md, settings.json, mcp.json, statusline.sh
scripts/              # install.sh, sync.sh, migrate-repo.sh
```

### Hooks

| Hook | Event | What it does |
|------|-------|--------------|
| `block-dangerous-commands` | PreToolUse(Bash) | Blocks catastrophic/risky commands (rm of home/root, force-push main, `curl\|sh`, …). Default level `high`. |
| `protect-secrets` | PreToolUse(Read/Edit/Write/Bash) | Blocks reading/exfiltrating `.env`, SSH/cloud keys, credentials. Only `.env.example`-style files are allowed. |
| `format-on-edit` | PostToolUse(Edit/Write) | Runs Prettier on the edited file if a local Prettier is available (no-op otherwise). |
| `auto-stage` | PostToolUse(Edit/Write) | `git add`s files Claude modifies so `git status` shows exactly what changed. |
| `notify-permission` | Notification | Sends a Slack alert when Claude needs input. Set `CCH_SLA_WEBHOOK`. |

Safety levels (`critical` < `high` < `strict`) are set near the top of each pre-tool-use hook.

## Install (per machine)

```bash
# from a published GitHub repo
claude plugin marketplace add elliottsencan/2ts-claude
claude plugin install 2ts-claude@2ts-claude

# or from this local checkout
claude plugin marketplace add ~/git/personal-dev/2ts-claude
claude plugin install 2ts-claude@2ts-claude
```

Or run `scripts/install.sh`.

## Update workflow

- **Ship (from anywhere):** edit, `git commit`, `git push`. That's the whole publish step.
- **Pull (per machine):** run `scripts/sync.sh`, or:
  ```bash
  claude plugin marketplace update 2ts-claude
  claude plugin update 2ts-claude@2ts-claude
  ```

Updates are not automatic — nothing changes on a machine until you pull.

## Personal config (`~/.claude-personal`)

These repos use a separate Claude config dir so personal work runs under a personal account, isolated from work.

- `scripts/migrate-repo.sh` — run in any repo to point it at `~/.claude-personal` via direnv (writes `.envrc`, gitignores it, runs `direnv allow`).
- `templates/` — starting points to copy into `~/.claude-personal/`:
  - `CLAUDE.md` → cross-project conventions
  - `settings.json` → permission allowlist + enables this plugin
  - `mcp.json` → common MCP servers (copy to a repo as `.mcp.json`)
  - `statusline.sh` → status line

## Tests

```bash
npm test   # runs the hook test suite (262 tests)
```
