#!/usr/bin/env bash
# sync.sh — Pull the latest toolkit on this machine.
# Ship from anywhere with `git push`; run this where you want the update.
set -euo pipefail

echo "Updating marketplace metadata..."
claude plugin marketplace update 2ts-claude

echo "Updating plugin..."
claude plugin update 2ts-claude@2ts-claude

echo ""
echo "Synced. Current plugins:"
claude plugin list
