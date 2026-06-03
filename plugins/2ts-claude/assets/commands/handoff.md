Generate a self-contained handoff prompt that another agent can use to pick up this work cold, with zero conversation history.

Survey the current state before writing the prompt:

- Run `git status`, `git branch --show-current`, and `git diff` (staged and unstaged) to see uncommitted work
- Run `git log --oneline main..HEAD` to see commits on this branch
- Re-read any plans in `.claude/plans/` referenced in this session
- Re-read any files modified or extensively discussed this session — quote the specific paths and line numbers the new agent will need
- Note any TodoWrite items still pending, any user feedback/corrections received, and any decisions made (and the reasoning)

Then output the handoff prompt **inline in chat** inside a fenced ```text block so I can copy it cleanly. Do not write it to a file. Do not include preamble or commentary outside the fence — just the fenced prompt.

The prompt itself must be written **as if briefing a smart colleague who just walked into the room** — they have no conversation history, don't know what's been tried, don't know why the task matters. Include:

1. **Goal** — what we're trying to accomplish and why (1-3 sentences)
2. **Branch & repo state** — current branch name, what's committed vs uncommitted, any stacked-branch context
3. **What's been done** — concrete progress with file paths and line numbers (e.g., "implemented X in `src/foo.ts:42-88`")
4. **What's been decided** — design/approach choices already settled, with the reasoning. Include things ruled out and why.
5. **User feedback received this session** — any corrections, preferences, or "don't do X" guidance the new agent should respect
6. **What's left** — the punch list of remaining work, in order
7. **Open questions / blockers** — anything that needs a decision from the user before proceeding, or unknowns the new agent should resolve early
8. **Relevant files** — the small set of files the new agent should read first, with one-line descriptions of why each matters
9. **Verification** — how the new agent will know the work is done (tests to run, behavior to confirm)

Be specific. "Refactor the checkout flow" is useless; "Extract the total calculation in `cart-summary.ts:120-145` into a shared util at `pricing-util.ts`, following the pattern in `computeLineTotal()`" is a handoff. Quote file paths, function names, error messages, decisions verbatim. Synthesis is your job — don't push it onto the next agent with "based on the context, figure out what to do next."

Cap the prompt at what's necessary. Skip sections that genuinely don't apply (e.g., omit "Open questions" if there are none) rather than padding with "N/A".
