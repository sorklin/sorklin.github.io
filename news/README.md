# The Daily Brief — writer contract

`/news/` is a dedicated, machine-written section: **the day's security news —
AI security and "regular" security — published every morning.** A separate
process (not this repo's usual editors) owns the content. The only thing it
ever touches is:

```
news/news.json
```

Everything else in this folder is static chrome owned by the site. The page
(`index.html`) renders the feed client-side from `assets/js/news.js`; nothing
else needs to change when a new day is published. **For the step-by-step
runbook aimed at the writing agent, see `AGENT-INSTRUCTIONS.md`.**

---

## The file

```json
{
  "version": 3,
  "updated": "2026-10-11",
  "days": [
    {
      "date": "2026-10-11",
      "items": [
        {
          "category": "ai",
          "title": "Agent framework patches prompt-injection flaw triggered by crafted documents",
          "tldr": "One punchy line, always visible under the title: the hook plus the single most important fact.",
          "source": "The Register",
          "url": "https://www.theregister.com/security/example-story/",
          "summary": "Two or three sentences on what actually happened and why it matters. Factual, no hype, no first-person.",
          "details": [
            "Key-fact bullets, one string each — timelines, versions, CVE ids, attribution, response steps.",
            "Keep each bullet one fact; the renderer shows them as a plain dash list inside the expandable box."
          ],
          "links": [
            { "label": "The Register — full write-up", "url": "https://www.theregister.com/security/example-story/" },
            { "label": "Vendor bulletin — advisory GHSA-xxxx", "url": "https://example.com/vendor-advisory/" }
          ]
        },
        {
          "category": "security",
          "title": "Ivanti patches VPN zero-day exploited in the wild",
          "tldr": "The collapsed view is exactly title + this line — so it should stand alone without the summary.",
          "source": "BleepingComputer",
          "url": "https://www.bleepingcomputer.com/news/security/example-story/",
          "summary": "Two or three sentences on what actually happened and why it matters. Factual, no hype, no first-person.",
          "details": ["One fact per string; omit details entirely for thin stories."],
          "links": [
            { "label": "BleepingComputer — original report", "url": "https://www.bleepingcomputer.com/news/security/example-story/" }
          ]
        }
      ]
    }
  ]
}
```

## What the page shows

Collapsed, each story is: **badge · source · title (link) · TL;DR** — nothing
else. The title links to `url`. Everything else — `summary`, `details`
(rendered as a dash list) and `links` (rendered as a labelled source list) —
sits inside a native `<details>` accordion, collapsed by default and labelled
"Summary · Key facts · Sources" according to what the item actually carries.
An item with none of those three simply has no accordion. **Every link the
renderer emits — title and sources alike — opens in a new tab/window**
(`target="_blank" rel="noopener noreferrer"`, enforced in one place).

**Anchors** (what the homepage strip deep-links to): each day section gets
`id="day-<date>"` and each story `id="story-<date>-<n>"`, where `<n>` is the
story's **1-based position in that day's `items` array** — derived from the
feed file itself, so the strip and the page always agree, and stories with
malformed URLs (which the renderer skips) don't shift later stories' anchors.
The strip's headlines link to `#story-…` and its "Today's briefing" to the
top of the newest day (`#day-…`); landing on a story auto-opens its
accordion. Reordering a day's items after publishing changes that day's
story anchors (only stale external deep links care); adding a new day never
does.

## Schema

| Field | Type | Rules |
|---|---|---|
| `version` | number | Always `3`. Bump only if the shape changes — and then update the renderer. |
| `updated` | string \| null | `YYYY-MM-DD` of the newest day, or `null` while the feed is empty. |
| `days` | array | **Newest day first.** Each entry is one calendar day. |
| `days[].date` | string | `YYYY-MM-DD`. One entry per date — never two. |
| `days[].items` | array | 0 or more stories. The renderer preserves your order within a day, so put the most important story first. |
| `items[].category` | string | `"ai"` = **AI security**: stories where AI is the target, the weapon or the incident — model breaches, prompt injection, AI-powered attacks, AI security policy. `"security"` = **"regular" security**: the rest of the wire — breaches, CVEs, ransomware, advisories, general cyber policy. A story spanning both gets the louder one. A pure AI story with no security angle does not belong in this feed. Anything else renders under a neutral "News" tag (it degrades, it doesn't disappear). |
| `items[].title` | string | The headline as summarised, ≤ ~120 characters. Plain text — never HTML or markdown. |
| `items[].tldr` | string | **One line, always visible** under the title in the collapsed view. Should stand alone: hook + the single most important fact. Plain text. |
| `items[].source` | string | Publication of the primary link, e.g. `"BleepingComputer"`. Plain text. |
| `items[].url` | string | **Absolute** `https://` URL of the primary story — the link the title opens (always in a new tab; that rule lives in the renderer, not in the data). |
| `items[].summary` | string | 1–3 sentences, shown when the accordion opens. Plain text. No trailing "read more". |
| `items[].details` | string[] | Optional. The "Key facts" bullets — one fact per string (timelines, versions, CVE ids, attribution, response steps). Omit for thin stories. |
| `items[].links` | {`label`, `url`}[] | Optional. All sources for the story, primary one first — each rendered as a labelled link that opens in a new tab. `label` is `"Publication — short note"`; `url` must be absolute `https://`. |

The report you compile maps 1:1 onto this: story heading → `title`, **TL;DR**
→ `tldr`, **Summary** → `summary`, the **Key facts** bullets → `details`
(one string per bullet, markdown stripped), and the **Links** list →
`links` (`label` = the link's label text, `url` = the URL). `source` and
`url` come from the primary link.

Unknown extra fields are ignored by the renderer, so it is safe to add
metadata later without a version bump.

## The daily write, precisely

1. **Load** `news/news.json`.
2. **Prepend** today's day object `{ "date": "<today>", "items": [...] }`.
   If a day object with today's date already exists (a re-run), **replace**
   it — never duplicate a date.
3. **Trim**: drop day objects older than 90 days.
4. **Set** `updated` to today's `YYYY-MM-DD`.
5. **Write the whole file back** (it is a full-file rewrite, not an append).
6. **Validate**: `node scripts/check.mjs` must pass — it parses the feed and
   enforces the schema above, so run it before committing/pushing whatever
   transport you use.

That is the entire job. No HTML, no sitemap, no nav edits — the section page,
homepage strip, and checker all read this one file.

## Guarantees the renderer makes (so the writer doesn't have to)

- Feed content is inserted with `textContent`/attributes only — **markup in
  any string field is treated as text**, not HTML. Don't put entities or tags
  in the fields; they will show literally.
- `url` values that are not absolute `http(s)` links are dropped silently.
- Days are re-sorted newest-first client-side, but keeping the file sorted is
  part of the contract anyway (the checker enforces it).
- Missing `source`, `summary`, `tldr`, `details` or `links` degrade gracefully
  (the accordion simply omits the missing sections). A missing/bad `title` or
  `url` is a contract violation (the checker catches it pre-push).
- Dates are parsed as calendar dates (no timezone slide) and get a
  "Today"/"Yesterday" tag when they qualify.

## Local preview

```powershell
.\serve.ps1          # from the repo root, then open http://localhost:8080/news/
```

The page shows a "No briefings yet" state while `days` is empty — the
correct look until the first run. **The step-by-step runbook for whoever
writes the feed — human or agent — is `AGENT-INSTRUCTIONS.md`**; the rest
of this document is the design contract and the reasoning behind it.

## Design notes (why it is built this way)

- **One JSON file, not per-day HTML files**: the writer process stays a
  trivial read-modify-write of a single blob, the site stays a no-build
  static site, and GitHub Pages serves it as-is. At ~10 items/day the file
  is well under 200 KB at the 90-day cap — smaller than one article image.
- **Client-side render**: keeps the chrome in one place and lets filters /
  paging work without a server. The `<noscript>` fallback points at the raw
  JSON; this section is a reading convenience, not an archive of record.
- **The 90-day trim** is a writer responsibility, not a renderer one — the
  checker warns if the file outgrows it.
- **Deep dives are two-file.** A deep dive is long-form agent research, far
  too big for an expandable card, so the feed carries only a small card
  (`type: "deep-dive"` + `slug` + title/`tldr`/`source` — no body) under its
  day, and the full text lives in `news/deep-dives.json`: an append-only
  library (`version: 1`, `dives[]` with the full `tldr`/`summary`/
  `details`/`links`) that the 90-day trim never touches. The viewer page
  `/news/deep-dive/?s=<slug>` renders the body client-side from that
  library under the same textContent-only safety rules; a missing slug or
  file renders a readable error state with a way back. The checker
  cross-validates: every feed card's slug must exist in the library.
  **The deep-dive agent's runbook is `DEEP-DIVE-INSTRUCTIONS.md`.**

## Ideas deliberately left out (rough-out scope)

- RSS/Atom (`/news/rss.xml` the writer would also rewrite) — cheap to add
  later; the JSON already has everything an RSS generator needs.
- Per-item images, tags beyond the two, or per-day editorial notes.
- Search across the archive — 90 days is small enough to scroll.
