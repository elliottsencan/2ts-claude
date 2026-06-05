Check whether this PR is genuinely ready for review, then (on my OK) mark it ready.

Survey the PR and branch:

- `gh pr view --json number,isDraft,title,body,statusCheckRollup`
- `git diff main...HEAD` and `git log --oneline main..HEAD`

Run a definition-of-done checklist against the actual diff and report PASS / GAP for each, with specifics:

- **Tests** — new or changed behavior has tests, and the suite passes locally.
- **Docs** — user-facing changes update the relevant docs/README/comments.
- **PR description** — every section of the repo's PR template is filled, not left as a placeholder.
- **Hygiene** — no stray `console.log`/debug prints, no leftover `TODO`/`FIXME` added by this branch, no commented-out code, no focused tests (`.only`).
- **CI** — checks are green (or only pending).

Show me the checklist as a table with one concrete note per row, and list the gaps explicitly.

If everything passes and the PR is a draft, **ask me before flipping it** — on my OK, `gh pr ready <number>`. If there are gaps, don't mark it ready; tell me what to fix first.
