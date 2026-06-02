---
name: code-standards
description: Personal code quality standards — logging, comment philosophy, code review criteria, and a systematic debugging process. Use when reviewing code, debugging issues, refactoring, or enforcing standards.
---

# Code Standards

General-purpose code quality standards for reviewing, debugging, and refactoring. Language-agnostic in principle; examples are in TypeScript.

## Logging

**Avoid `console.log` in shipped code.** Use the project's logger if one exists; reserve raw `console.*` for throwaway debugging and remove it before committing.

- Use appropriate levels: `debug` (developer detail), `info` (status/progress), `warn` (recoverable concern), `error` (failure).
- Include structured context, not vague strings.

```ts
// ✅ Context attached
logger.info('Order created', { orderId: order.id, userId: user.id });

// ❌ Vague
logger.info('Order created');
```

## Comments

**Minimize inline comments.** Prefer self-documenting code through clear naming.

**✅ Comment for:** non-obvious business rules, framework workarounds, performance trade-offs, regex intent, public API docs.
**❌ Don't comment:** obvious code, step-by-step narration, restating code, or commented-out code (delete it).

```ts
// ❌ BAD: obvious / needs a comment to be readable
const d = 86400000; // ms in a day
const x = new Date(t + d * 7);

// ✅ GOOD: self-explanatory
const MILLISECONDS_PER_DAY = 86_400_000;
const futureDate = new Date(timestamp + MILLISECONDS_PER_DAY * 7);

// ✅ GOOD: explains a non-obvious workaround
// Stripe webhooks can arrive out of order; ignore events older than the last applied one.
if (event.created < lastAppliedAt) return;
```

## Code Review

Evaluate changes against these criteria and report findings by priority.

1. **Readability & simplicity** — small focused functions, minimal nesting, early returns.
2. **Naming** — verbs for functions (`loadOrder`), nouns for values (`orderTotal`), questions for booleans (`isLoading`), `PascalCase` types, `UPPER_SNAKE_CASE` constants.
3. **Duplication** — extract repeated logic into shared helpers.
4. **Error handling** — no swallowed errors, no inconsistent state on failure, user-friendly messages, log with context.
5. **Input validation** — validate all user input and external data.
6. **Security** — no hardcoded secrets, sanitize untrusted input, enforce authz at the boundary.
7. **Type safety** — avoid `any`, handle null/undefined, narrow unions.
8. **Performance** — avoid needless O(n²), manage resources, derive instead of recompute.

### Feedback structure

```
🚨 Critical — must fix before merge (security, bugs, breakage)
⚠️ Warning  — should fix (quality, standards)
💡 Suggestion — would improve (clarity, perf, maintainability)
```

Reference `file:line`, explain the problem, show a concrete fix. Review what changed — don't demand unrelated refactors.

## Debugging

A systematic process, not guess-and-check.

1. **Analyze** — read the error/stack carefully; identify the failure location; establish when it started and what changed (`git log`, `git diff`).
2. **Hypothesize** — list 2-3 likely root causes, ranked.
3. **Trace** — follow data/execution from source to failure point; check boundaries (serialization, env/config, API contracts).
4. **Instrument** — add targeted, temporary logging to gather evidence; remove it after.
5. **Fix at the root** — minimal, precise change addressing the cause, not the symptom.
6. **Verify** — reproduce first, then confirm the fix against the reproduction; add a regression test where it makes sense.

For each issue, state: **root cause**, **evidence**, **fix**, **verification**, **prevention**.

Common culprits: unawaited promises / race conditions, stale closures, mutation where immutability is expected (reference equality), unhandled null/undefined, and env/config differences between local and prod.
