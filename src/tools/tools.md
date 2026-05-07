# Agent Tools Reference

All tools are invoked via Bash using `npx tsx src/tools/<script> <args>`. Each tool prints JSON to stdout and exits 0 on success.

---

## Search & Discovery

### `web_search`

```
npx tsx src/tools/run-search-web.ts "<query>" [--max-results <n>] [--include-domains <d1,d2>] [--exclude-domains <d1,d2>] [--after-date <YYYY-MM-DD>]
```

Semantic web search via the Parallel Web API.

**Parameters:**
- `<query>` — natural-language search objective (required)
- `--max-results <n>` — number of results (default: 10)
- `--include-domains <d1,d2>` — restrict results to these domains (comma-separated)
- `--exclude-domains <d1,d2>` — exclude these domains from results (comma-separated)
- `--after-date <YYYY-MM-DD>` — only return content published after this date

**Output:** JSON array of `{ url, title, domain, excerpts[] }`

**Examples:**
```bash
# General web search
npx tsx src/tools/run-search-web.ts "Claude Code workflow tips" --max-results 10

# Subreddit-scoped search (replaces reddit_search)
npx tsx src/tools/run-search-web.ts "Claude Code workflow" --include-domains reddit.com/r/ClaudeCode

# Broad Reddit search (replaces reddit_search_broad)
npx tsx src/tools/run-search-web.ts "AI coding agents" --include-domains reddit.com

# Authority sources only (replaces searchAuthority)
npx tsx src/tools/run-search-web.ts "Claude Code setup" --exclude-domains reddit.com,twitter.com,x.com,medium.com

# Recent content only
npx tsx src/tools/run-search-web.ts "Claude Code agents" --after-date 2025-01-01
```

**Agents:** scout, researcher

---

### `hn_search`

```
npx tsx src/tools/run-search-hn.ts "<query>" [--days-back <n>] [--max-results <n>]
```

Searches Hacker News via the Algolia API. Returns stories sorted by points.

**Parameters:**
- `<query>` — search query (required)
- `--days-back <n>` — how far back to search (default: 7)
- `--max-results <n>` — number of results (default: 15)

**Output:** JSON array of `{ title, url, points, num_comments, created_at, objectID }`

To get the HN discussion thread: `https://news.ycombinator.com/item?id={objectID}`

**Agents:** scout, researcher

---

### `extract`

```
npx tsx src/tools/run-extract.ts "<url1>" ["<url2>" ...] [--objective "<question>"]
```

Extracts full content from URLs via the Parallel Web API. On error, returns `[]` without crashing.

**Parameters:**
- `<url1> ... <url20>` — up to 20 URLs (required)
- `--objective "<question>"` — focus extraction on a specific question

**Output:** JSON array of `{ url, title, publish_date, excerpts[] }`

**Agents:** researcher

---

## URL Ledger

Tracks which URLs have been seen across pipeline runs to detect fresh vs. recurring content.

### `ledger_check`

```
npx tsx src/tools/run-ledger-check.ts '<json-array>'
```

Read-only freshness check. Does NOT update the ledger.

**Input:** JSON array of `[{ "url": "...", "score": 42, "num_comments": 10 }, ...]`

**Output:**
```json
{
  "results": [{ "url": "...", "freshness": "new|resurfaced|recurring", "first_seen": "..." }],
  "summary": { "new": 0, "resurfaced": 0, "recurring": 0 }
}
```

Freshness values:
- `new` — first time seen. High signal.
- `resurfaced` — seen before but engagement grew significantly. Worth watching.
- `recurring` — seen before, no growth. Low signal.

**Agents:** scout

---

### `ledger_update`

```
npx tsx src/tools/run-ledger-update.ts '<json-array>'
```

Records URLs into the ledger. Call after `ledger_check` with only the URLs worth tracking.

**Input:** JSON array of `[{ "url": "...", "score": 42, "num_comments": 10, "source": "hn" }, ...]`

**Output:** `{ "added": 0, "updated": 0, "total": 0 }`

**Agents:** scout

---

### `ledger_stats`

```
npx tsx src/tools/run-ledger-stats.ts
```

Read-only. Returns aggregate ledger statistics.

**Output:** `{ "total": 0, "age_distribution": { "last_24h": 0, "last_7d": 0, "last_30d": 0, "older": 0 }, "by_source": {} }`

**Agents:** scout

---

## Publishing

### `publish`

```
npx tsx src/tools/run-publish.ts <draft-json-path> <output-json-path> [--refresh-slug <slug>]
```

Creates a Ghost draft post (or updates an existing post with `--refresh-slug`). Requires `GHOST_URL` and `GHOST_ADMIN_KEY` env vars. Uses HS256 JWT auth — do not attempt to replicate this manually.

**Parameters:**
- `<draft-json-path>` — path to ContentDraft JSON (required)
- `<output-json-path>` — where to write the publisher result JSON (required)
- `--refresh-slug <slug>` — slug of existing post to update instead of creating new

**Output:** Prints the Ghost post URL to stdout on success. Writes result JSON to `<output-json-path>`.

**Agents:** creator

---

### `validate`

```
npx tsx src/tools/run-validate.ts <draft-json-path> <context-path> <output-json-path>
```

Validates a ContentDraft against quality criteria. Exit codes: 0 = approved, 1 = rejected, 2 = error.

**Parameters:**
- `<draft-json-path>` — path to ContentDraft JSON (required)
- `<context-path>` — path to product context file
- `<output-json-path>` — where to write ValidationResult JSON (required)

**Agents:** creator

---

### `syndicate`

```
npx tsx src/tools/run-syndicate.ts <draft-json-path> <canonical-url> <playbook-json-path> <output-json-path>
```

Syndicates a published article to Dev.to and Hashnode based on the distribution playbook. Requires `DEVTO_API_KEY`, `HASHNODE_PAT`, `HASHNODE_PUBLICATION_ID` env vars.

**Parameters:**
- `<draft-json-path>` — path to ContentDraft JSON (required)
- `<canonical-url>` — the Ghost URL for the published post (required)
- `<playbook-json-path>` — path to distribution playbook JSON (required)
- `<output-json-path>` — where to write syndication result JSON (required)

**Agents:** creator

---

## Agent Access Summary

| Tool | scout | researcher | creator | strategist | meta-agent |
|------|-------|------------|---------|------------|------------|
| `web_search` | ✓ | ✓ | | | |
| `hn_search` | ✓ | ✓ | | | |
| `extract` | | ✓ | | | |
| `ledger_check` | ✓ | | | | |
| `ledger_update` | ✓ | | | | |
| `ledger_stats` | ✓ | | | | |
| `validate` | | | ✓ | | |
| `publish` | | | ✓ | | |
| `syndicate` | | | ✓ | | |
