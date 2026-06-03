#!/usr/bin/env bash
# install-git-helpers.sh — Set up the `git acp` workflow and Claude-generated
# commit messages.
#
# Two parts:
#   1. Global git aliases (machine-wide, idempotent):
#        git acp  — refuse on main, then `git add . && git commit && git push`
#        git cc   — `git commit` flagged for Claude (CLAUDE=1)
#   2. A per-repo `prepare-commit-msg` hook that, on a message-less commit,
#      generates one with `claude --model haiku`.
#
# Aliases are global by nature. The hook installs into the CURRENT repo only,
# so run this from each repo where you want auto-generated commit messages.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="$SCRIPT_DIR/../templates/hooks/prepare-commit-msg"

echo "Setting global git aliases (acp, cc)..."
git config --global alias.acp '!f() { branch=$(git rev-parse --abbrev-ref HEAD); if [ "$branch" = "main" ]; then echo "Cannot use acp on main branch"; exit 1; fi; git add . && git commit && git push; }; f'
git config --global alias.cc '!f() { CLAUDE=1 git commit "$@"; }; f'

# Install the commit-message hook into the current repo, if we're in one.
if git rev-parse --git-dir > /dev/null 2>&1; then
    HOOKS_DIR="$(git rev-parse --git-path hooks)"
    mkdir -p "$HOOKS_DIR"
    DEST="$HOOKS_DIR/prepare-commit-msg"
    if [ -e "$DEST" ] && ! cmp -s "$HOOK_SRC" "$DEST"; then
        echo "Backing up existing hook to $DEST.bak"
        cp "$DEST" "$DEST.bak"
    fi
    cp "$HOOK_SRC" "$DEST"
    chmod +x "$DEST"
    echo "Installed prepare-commit-msg hook into $(git rev-parse --show-toplevel)"
else
    echo "Not inside a git repo — skipped hook install."
    echo "Re-run this from a repo to add the commit-message hook there."
fi

echo ""
echo "Done."
echo "  git acp           # add . + commit (Claude message) + push"
echo "  git commit        # commit with a Claude-generated message"
echo "  CLAUDE_COMMIT_MODEL=sonnet git commit   # override the model"
