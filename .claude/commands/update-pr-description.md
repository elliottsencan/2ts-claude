Generate (or regenerate) this PR's description from the repo's PR template, and update the PR — keeping the existing description as a collapsed reference.

Resolve the PR for the current branch first: `gh pr view --json number,title,body,headRefName`. If there's no PR yet, tell me and stop — this updates an existing PR.

Survey the actual change before writing:

- `git diff main...HEAD` (and `git diff` for anything unstaged) for the real diff
- `git log --oneline main..HEAD` for the commits
- Read the repo's PR template if present (`.github/pull_request_template.md`) and fill **its** sections. If there's none, use: Summary, Changes, Testing / how to verify, Risk & rollback, Linked issues.

Draft the description: specific, every claim traceable to the diff, the summary leading with the user-facing outcome, no invented testing. Show it to me inline in a fenced ```markdown block.

Then update the PR body, **preserving the original**. The body uses stable markers so re-running replaces only the generated part and never stacks:

```
<!-- 2ts-claude:pr-description -->
…the generated description…
<!-- /2ts-claude:pr-description -->

<details>
<summary>📄 Original description</summary>

<!-- 2ts-claude:original-description -->
…the body exactly as it was the first time this ran…
<!-- /2ts-claude:original-description -->

</details>
```

- If the current body already has these markers, replace only the `pr-description` block and leave the `original-description` block untouched.
- If it doesn't, capture the entire current body verbatim into the `original-description` block — the one-time snapshot of the description as it exists now.

Outward-facing step — **ask me before pushing it to GitHub.** On my OK, write the composed body to a temp file and run `gh pr edit <number> --body-file <file>`. Don't change anything else on the PR (title, labels, reviewers).
