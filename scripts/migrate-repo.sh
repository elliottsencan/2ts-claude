#!/bin/bash
# migrate-repo.sh — Run from any repo root to point it at ~/.claude-personal
set -euo pipefail

# Create .envrc
echo 'export CLAUDE_CONFIG_DIR=~/.claude-personal' > .envrc
echo "✓ Created .envrc"

# Add .envrc to .gitignore
if [ -f .gitignore ]; then
  grep -qxF '.envrc' .gitignore || echo '.envrc' >> .gitignore
else
  echo '.envrc' > .gitignore
fi
echo "✓ Added .envrc to .gitignore"

# Allow direnv
direnv allow .
echo "✓ direnv allowed"

echo ""
echo "Done! Next: restart claude in this repo and /login with your personal account."
