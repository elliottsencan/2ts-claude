Check my personal wiki (elliottsencan.com) for entries relevant to what I'm working on, so I can pull in accumulated reading before writing code.

The wiki is a compiled knowledge base of concepts I've read about. This command surfaces the entries most relevant to a topic — on demand.

**Resolve the topic:**

- If I gave an argument after `/wiki`, use it as the query.
- If I didn't, infer the topic from what we're actively working on — the current task, the files in context, the problem being solved — and use that as the query.

**Run the scorer** (it reads `$ELLIOTTSENCAN_WIKI_DIR`; do not pass secrets):

```
node "${CLAUDE_PROJECT_DIR}/.claude/local/hooks/wiki-query.cjs" "<topic>" --json --limit 5
```

- If `$ELLIOTTSENCAN_WIKI_DIR` is unset, or the scorer prints `[]` / nothing, tell me the wiki isn't configured or has no relevant entries — don't invent results.

**Present the matches** concisely: for each hit, one line with the title, a short bit of the summary, and its `/wiki/<slug>` path (link as `https://elliottsencan.com/wiki/<slug>`), ordered by score. Then, in one or two sentences, say how the top entry relates to what we're doing — or note that nothing looks relevant. Don't dump the full bodies; this is a pointer, not a paste.

Do not fetch the live site or run anything beyond the local scorer.
