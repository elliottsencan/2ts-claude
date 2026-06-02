# 2ts-claude

![CI](https://github.com/elliottsencan/2ts-claude/actions/workflows/ci.yml/badge.svg)
[![Built with Claude Code](https://img.shields.io/badge/built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

My personal [Claude Code](https://claude.com/claude-code) toolkit, packaged as a plugin.

## What's inside

Hooks that run automatically:

- `block-dangerous-commands` stops destructive shell commands, like `rm` of your home or root, force-pushing main, or piping `curl` into a shell.
- `protect-secrets` stops reading or leaking `.env` files, SSH keys, and credentials. Only example files such as `.env.example` are allowed.
- `format-on-edit` runs Prettier on a file after it is edited, when Prettier is available.
- `auto-stage` runs `git add` on files the assistant changes, so `git status` shows the diff.
- `notify-permission` sends a Slack message when the assistant needs input. Set `CCH_SLA_WEBHOOK`.

Agents: `code-reviewer` and `bug-hunter`.

Skill: `code-standards`, with conventions for logging, comments, code review, and debugging.

Command: `handoff`, which writes a self-contained prompt to pass work to another session.

## Install

```bash
claude plugin marketplace add elliottsencan/2ts-claude
claude plugin install 2ts-claude@2ts-claude
```

## Update

```bash
claude plugin marketplace update 2ts-claude
claude plugin update 2ts-claude@2ts-claude
```

## Tests

```bash
npm test
```
