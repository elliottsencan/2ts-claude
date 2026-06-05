Draft a pull-request title and body for the current branch, ready to copy.

Survey the branch state before writing anything:

- Run `git status` and `git branch --show-current` to see the current branch and what's uncommitted
- Run `git diff main...HEAD` (and `git diff` for anything still unstaged) to see the actual changes
- Run `git log --oneline main..HEAD` to see the commits on this branch

Then output the PR **inline in chat** inside a single fenced ```markdown block so I can copy it cleanly. Do not write it to a file. Do not include preamble or commentary outside the fence — just the fenced PR. Start the fence with a `# <title>` line (a concise, conventional-commit-style title), followed by these sections:

1. **Summary** — what this PR does and why, in 1-3 sentences. Lead with the user-facing outcome, not the implementation.
2. **Changes** — the notable changes as a bullet list, each citing the relevant file(s) (e.g. "Add retry logic in `src/client.ts`"). Group related edits; don't just restate the diff line by line.
3. **Testing** — how the change was verified: tests added/run, commands, manual checks. If something wasn't tested, say so honestly.
4. **Risk & rollback** — the blast radius and how to revert if it goes wrong.

Be specific and trace every claim to the diff — don't invent testing that didn't happen or changes that aren't there. Keep it tight; skip a section only if it genuinely doesn't apply rather than padding it.

Do **not** run `gh pr create` or push — committing and pushing is my call, not yours. After the fenced block, you may print the `gh pr create` command (with `--title`/`--body-file` or `--web`) for me to run myself.
