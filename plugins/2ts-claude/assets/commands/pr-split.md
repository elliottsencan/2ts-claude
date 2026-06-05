Propose how to split this branch into smaller, independently-reviewable PRs.

Survey the full change:

- `git diff main...HEAD --stat` and the full `git diff main...HEAD`
- `git log --oneline main..HEAD`

Identify logical, self-contained slices — group changes by concern (e.g. "refactor X", "new feature Y", "tests for Y", "unrelated cleanup"). A good slice compiles and passes on its own and can be reviewed without the others.

Output the plan inline — **don't touch git, this is advice.** For each proposed slice give:

1. A conventional-commit-style title.
2. The files it contains (or specific hunks, when one file splits across slices).
3. A one-line rationale, and any dependency on an earlier slice (the order to land them).

Call out anything that can't be cleanly separated, and why. End with the concrete next step to carve off the first slice (e.g. the `git`/`git add -p` commands) — but let me run it.
