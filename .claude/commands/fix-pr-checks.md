Diagnose and fix this PR's failing CI checks.

Survey the check state first:

- `gh pr checks` (or `gh pr view --json statusCheckRollup`) to see which checks failed
- For each failure, pull the logs: find the run with `gh run list --branch "$(git branch --show-current)"`, then read the failing steps with `gh run view <run-id> --log-failed`

For each failing check:

1. Read the failing log and identify the root cause — don't guess from the check name.
2. Fix it in code. Reproduce locally where possible by running the same command the job runs (test, lint, build, typecheck).
3. Re-run that command locally to confirm it now passes.

Show me a summary: check → root cause → fix → local verification. If a failure is environmental or flaky rather than a real defect, say so plainly instead of forcing a change.

Pushing is my call — **don't push or re-run remote jobs without asking.** Make and locally verify the fixes, then stop for my review; on my OK, push so CI re-runs.
