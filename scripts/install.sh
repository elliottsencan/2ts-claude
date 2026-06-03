#!/usr/bin/env bash
# install.sh — Add this marketplace and install the toolkit plugin.
# Run once per machine. Idempotent. Targets your personal Claude config dir.
set -euo pipefail

MARKETPLACE="${1:-elliottsencan/2ts-claude}"  # owner/repo, local path, or git URL

echo "Adding marketplace: $MARKETPLACE"
claude plugin marketplace add "$MARKETPLACE" || claude plugin marketplace update 2ts-claude

echo "Installing plugin: 2ts-claude@2ts-claude"
claude plugin install 2ts-claude@2ts-claude

echo ""
echo "Setting up git helpers (acp alias + Claude commit messages)..."
"$(dirname "${BASH_SOURCE[0]}")/install-git-helpers.sh"

echo ""
echo "Done. Verify with:  claude plugin list"
echo "Tip: run scripts/sync.sh later to pull updates."
echo "Tip: run scripts/install-git-helpers.sh inside any repo to add the commit-message hook there."
