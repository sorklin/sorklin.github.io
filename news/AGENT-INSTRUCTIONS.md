# The Daily Brief — agent instructions

You are the writer for **The Daily Brief** (`/news/`) on sorklin.com — a
machine-written feed of AI-security and "regular" security news, published
every morning. This document is the complete runbook; you should not need
anything else. (Design rationale lives in `README.md` in this same folder.)

## What you touch

Exactly one file:

```
news/news.json
```

Nothing else. Not the HTML, not the CSS, not the scripts, not the sitemap.
The whole section reads this one file — adding a day requires no other
change. Work from the repo root (the folder that contains `index.html`,
`news/`, `assets/` and `scripts/`).

## The seven rules

1. **Full-file rewrite.** Read `news/news.json`, modify the data, write the
   *entire* file back. Never append partial JSON; never create a second
   data file.
2. **Newest first.** The `days` array is ordered newest → oldest by `date`.
3. **One entry per date.** If the date you're publishing already exists,
   replace that entry in place — a re-run must never duplicate a day.
4. **Trim to 90 days.** After writing, drop any day older than 90 days.
5. **Plain text only.** Every string field renders as literal text — never
   put HTML, markdown (`**bold**`, `[links](…)`) or a trailing "read more"
   in any string. It will display exactly as written.
6. **Absolute `https://` URLs only.** Anything else is dropped by the
   renderer and flagged by the validator.
7. **Validate, then finish.** From the repo root run:

   ```
   node scripts/check.mjs
   ```

   It must print `✓ daily brief feed OK: …` and finish with no `✗` errors
   (`!` warnings are tolerable but worth fixing). If Node is unavailable,
   validate the JSON parses and check every rule in §Field rules by hand.

If the file contains `"_mock": true` (leftover preview data), delete that
key and its `_comment` sibling on your first real write.

## The shape of the file

```json
{
  "version": 2,
  "updated": "2026-10-11",
  "days": [
    { "date": "2026-10-11", "items": [ { …story… }, { …story… } ] },
    { "date": "2026-10-10", "items": [ { …story… } ] }
  ]
}
```

- `version` stays **2**.
- `updated` = the `date` of the newest day (or `null` only while the feed
  is completely empty).
- Each day is `{ "date": "YYYY-MM-DD", "items": [ … ] }`. Dates are the
  brief's publication date in **America/New_York** — if you're told
  "today", that is the ET calendar date, not UTC.
- Stories within a day are ordered **most important first**. That order is
  also the story's permanent anchor on the page (`#story-<date>-<n>`), so
  do not reorder a day's items after it has been published.

## A complete story

```json
{
  "category": "ai",
  "title": "Agent framework patches prompt-injection flaw triggered by crafted documents",
  "tldr": "One line, always visible under the title: the hook plus the single most important fact.",
  "source": "The Register",
  "url": "https://www.theregister.com/security/example-story/",
  "summary": "Two or three sentences on what happened and why it matters. Factual, no hype, no first person.",
  "details": [
    "Key-fact bullets, one fact per string — timelines, versions, CVE ids, attribution, response steps.",
    "Omit details entirely for thin stories; otherwise one string per bullet."
  ],
  "links": [
    { "label": "The Register — full write-up", "url": "https://www.theregister.com/security/example-story/" },
    { "label": "Vendor bulletin — advisory GHSA-xxxx", "url": "https://example.com/vendor-advisory/" }
  ]
}
```

### Field rules

| Field | Required | Rule |
|---|---|---|
| `category` | yes | `"ai"` or `"security"` — see *Choosing a category* below. |
| `title` | yes | The headline as summarised, ≤ ~120 characters, plain text. |
| `tldr` | yes* | ONE line that must stand alone — the collapsed view shows exactly title + TL;DR, nothing else. |
| `source` | yes | Publication of the primary link, e.g. `"BleepingComputer"`. |
| `url` | yes | Absolute `https://` link to the primary story — this is what the title opens (always in a new tab; the renderer enforces that). |
| `summary` | yes | 1–3 sentences, shown when the story's box is expanded. |
| `details` | no | Array of strings — the "Key facts" bullets, one fact per string. Omit for thin stories. |
| `links` | no | Array of `{ "label", "url" }` covering ALL sources, primary first. `label` = `"Publication — short note"`. |

\* A missing `tldr` only draws a warning, but the design expects one —
always write it.

### How the page uses each field

Collapsed, a reader sees: category badge · source · **title** (linked to
`url`) · **tldr**. Expanded — a small "Summary · Key facts · Sources" box —
the `summary`, the `details` as a dash list, and every `links` entry as a
labelled link that opens in a new tab. That is why `tldr` must be
self-sufficient: it is all a scanning reader gets.

## Choosing a category

- **`"ai"` — AI security.** Stories where AI is the target, the weapon or
  the incident: model breaches, prompt injection, agent misbehaviour,
  AI-powered attacks, the AI supply chain, AI security policy and
  regulation.
- **`"security"` — "regular" security.** The rest of the wire: breaches,
  CVEs and patches, ransomware, advisories, threat actors, general cyber
  policy.
- A story spanning both gets whichever is dominant. **A pure AI story with
  no security angle does not belong in this feed** — no model releases,
  funding rounds or benchmarks unless there is a security hook.

## Writing style

- Factual, past-or-present tense, no hype, no first person, no rhetorical
  questions, no exclamation marks.
- `tldr`: one sentence (two short ones at most) that survives without the
  summary.
- `summary`: what happened, who is affected, one hook of context.
- `details`: what a practitioner needs — exact versions, CVE ids,
  timelines, attribution, response steps ("pin 0.5.143; remove the monitor
  before revoking tokens").
- `links[].label`: `"Publication — what it is"`; primary source first.

## Publishing a day, step by step

1. Read `news/news.json`.
2. Build the day object: `{ "date": "YYYY-MM-DD", "items": [ … ] }`.
3. If that date already exists in `days`, replace it in place; otherwise
   **insert the new day at the front** (position 0).
4. Re-sort `days` newest-first; drop any day older than 90 days.
5. Set the top-level `updated` to the newest day's date.
6. Remove `_mock` / `_comment` keys if present.
7. Write the entire file back.
8. Run `node scripts/check.mjs`; resolve every error it reports.
9. Report what you published: the date, the number of stories, and the
   count per category.

Starting from an empty feed is the same job — create one day object per
date you've been given, newest first, and set `updated`.

## If you're given a compiled daily report (markdown)

The report format maps 1:1 onto the feed:

| In the report | In the feed |
|---|---|
| `#### N. Title` heading | `title` (drop the leading number) |
| `**TL;DR:** …` | `tldr` |
| `**Summary:** …` | `summary` |
| `**Key facts**` bullets | `details` — one string per bullet, markdown stripped |
| `**Links**` list | `links` — `label` = the link's label text, `url` = the URL |
| the section it sits under (AI security / General cybersecurity) | `category` (`"ai"` / `"security"`) |
| the link marked "Primary" | `source` and `url` |

## Final checklist

- [ ] Valid JSON — no trailing commas, no comments inside the file itself.
- [ ] `version` is `2`; `updated` equals the newest day's date.
- [ ] Days are newest-first; no duplicate dates; nothing older than 90 days.
- [ ] Every `url` and every `links[].url` starts with `https://`.
- [ ] No HTML or markdown in any string; no `_mock` key left behind.
- [ ] `node scripts/check.mjs` prints `daily brief feed OK` and finishes
      without `✗` errors.
