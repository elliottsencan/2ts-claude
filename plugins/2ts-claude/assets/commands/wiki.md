Check my personal wiki (elliottsencan.com) for entries relevant to what I'm working on, so I can pull in accumulated reading before writing code.

The wiki is a compiled knowledge base of concepts I've read about. This command surfaces the entries most relevant to a topic — on demand.

**Resolve the topic:**

- If I gave an argument after `/wiki`, use it as the query.
- If I didn't, infer the topic from what we're actively working on — the current task, the files in context, the problem being solved — and use that as the query.

**Run the scorer** (do not pass secrets):

```
node "${CLAUDE_PROJECT_DIR}/.claude/local/hooks/wiki-query.cjs" "<topic>" --json --limit 5
```

The scorer reads a locally-cached index of the wiki that it refreshes in the background from the canonical post-synthesis source (`$ELLIOTTSENCAN_WIKI_INDEX_URL`, default `https://elliottsencan.com/wiki.json`), falling back to a local clone at `$ELLIOTTSENCAN_WIKI_DIR`. It never blocks on the network — the first run after a fresh install may return nothing while the cache warms; a second run will have it.

- If the scorer prints `[]` / nothing, tell me the wiki has no relevant entries (or isn't configured yet) — don't invent results.

**Present the matches** concisely: for each hit, one line with the title, a short bit of the summary, and its `/wiki/<slug>` path (link as `https://elliottsencan.com/wiki/<slug>`), ordered by score. Then, in one or two sentences, say how the top entry relates to what we're doing — or note that nothing looks relevant. Don't dump the full bodies; this is a pointer, not a paste.

Run only the scorer — it manages its own cache refresh; don't fetch the live site yourself.
