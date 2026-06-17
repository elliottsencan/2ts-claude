# Review lessons

Confirmed, generalizable review findings — one short rule per line. The review agents
(`code-reviewer`, `bug-hunter`) read this file at the start of every run and check the diff
against each rule, so a lesson learned once is enforced on every future review instead of
being rediscovered.

This file is **append-only data**, not a vendored template. `/setup` seeds it once and then
leaves it alone — appends never trip conflict detection and survive `/setup --remove`. Add a
rule only when a human has confirmed the underlying finding and it generalizes beyond the
single diff that surfaced it.

Format, one per line: `- <imperative rule> — <why it matters>`

<!-- Append confirmed lessons below this line. -->
