---
description: "Maintainer-only: research current Claude Code best practices and open a PR proposing updates to this plugin's components. Run from the 2ts-claude repo."
---

You are maintaining the **2ts-claude** plugin itself. The goal: keep the *static, versioned* component set current with evolving best practices — WITHOUT ever wiring live research into `/setup` (that would break setup's determinism and idempotency). Research feeds the components upstream; a human reviews; it ships as a new version.

Only run this from the 2ts-claude repo. If `plugins/2ts-claude/scripts/components.cjs` is not present, stop and say so.

Steps:

1. **Inventory current state.** Read `plugins/2ts-claude/scripts/components.cjs` and `assets/` to list what the plugin currently ships (hooks, conventions, settings defaults, deny rules, CI workflows, AGENTS.md handling).

2. **Research (bounded — don't over-analyze).** Search the web for recent, reputable guidance on Claude Code / AI-coding-agent repo setup: hooks (PreToolUse/PostToolUse/SessionStart), permission allow/deny defaults, secret-scanning, prompt-injection defenses, AGENTS.md conventions, CI guardrails. Prefer official Claude Code docs and widely-cited sources. Cite every source.

3. **Diff against best practice.** For each candidate addition or change, judge it through the senior-engineer lens already established for this project: **a guardrail must be invisible until it saves you; anything that nags or false-positives gets disabled.** Reject low-value/high-friction ideas (per-session nags, false-positive-prone local blocks). Prefer CI over local hooks for scanning. Note where a candidate belongs: operator-only plugin side vs. durable target-repo component (see the project memory).

4. **Propose, don't impose.** Produce a short ranked list: for each proposal — value, friction, where it lives, and the concrete change (which file, what op/component). Keep the bar high; an empty result ("nothing worth adding") is a valid, good outcome.

5. **Open a PR (only if there are accepted proposals).** Create a branch, implement the agreed changes to `components.cjs`/`assets/` (plus tests), run `npm test`, and open a PR summarizing the research and the rationale. Do NOT modify `/setup`'s engine semantics. Let me review before merge.

To run this on a cadence, register it with `/schedule` (e.g. monthly). It is deliberately separate from `/setup`.
