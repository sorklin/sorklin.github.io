# The Daily Brief — agent instructions

You are the writer for **The Daily Brief** (`/news/`) on sorklin.com — a
machine-written feed of AI-security and "regular" security news, published
every morning. This document is the complete runbook; you should not need
anything else. (Design rationale lives in `README.md` in this same folder.)

## What you touch

At most two files:

```
news/news.json        the daily feed (cards only, trimmed to 90 days)
news/deep-dives.json  the deep-dive library (full bodies, never trimmed)
```

Deep dives are optional — when none were requested you only touch
`news/news.json`. Never anything else: not the HTML, not the CSS, not the
scripts, not the sitemap. The whole section reads these two files; adding a
day requires no other change. Work from the repo root (the folder that
contains `index.html`, `news/`, `assets/` and `scripts/`).

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
  "version": 3,
  "updated": "2026-10-11",
  "days": [
    { "date": "2026-10-11", "items": [ { …story… }, { …story… } ] },
    { "date": "2026-10-10", "items": [ { …story… } ] }
  ]
}
```

- `version` stays **3**.
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
  "industry": [
    { "code": "52", "name": "Finance and Insurance" },
    { "code": "61", "name": "Educational Services" }
  ],
  "title": "Agent framework patches prompt-injection flaw exploited at a bank and a university",
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
| `industry` | no | Array of `{ "code", "name" }` top-level NAICS sectors — see *Choosing industries* below. Omit entirely when none apply; the page answers with an `Unspecified` pill. |
| `title` | yes | The headline as summarised, ≤ ~120 characters, plain text. |
| `tldr` | yes* | ONE line that must stand alone — the collapsed view shows exactly title + TL;DR, nothing else. |
| `source` | yes | Publication of the primary link, e.g. `"BleepingComputer"`. |
| `url` | yes | Absolute `https://` link to the primary story — this is what the title opens (always in a new tab; the renderer enforces that). |
| `summary` | yes | 1–3 sentences, shown when the story's box is expanded. |
| `details` | no | Array of strings — the "Key facts" bullets, one fact per string. Omit for thin stories. |
| `links` | no | Array of `{ "label", "url" }` covering ALL sources, primary first. `label` = `"Publication — short note"`. |

\* A missing `tldr` only draws a warning, but the design expects one —
always write it.

(The table above is for regular stories. **Deep-dive cards** use `type` +
`slug` instead of `url` and carry only the card fields — see §Deep dives.)

### How the page uses each field

Collapsed, a reader sees: category badge · industry pills · source ·
**title** (linked to `url`) · **tldr**. Expanded — a small
"Summary · Key facts · Sources" box — the `summary`, the `details` as a dash
list, and every `links` entry as a labelled link that opens in a new tab.
Each `industry` entry renders as a green pill beside the category badge (a
single dim `Unspecified` pill when the item carries none), and the industry
dropdown above the list filters stories by sector. That is why `tldr` must
be self-sufficient: it is all a scanning reader gets.

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

## Choosing industries (`industry`)

Besides the topic tag, every story may carry **industry** tags: the
top-level NAICS sectors (per www.naics.com) of the **victims and targets** —
the organisations on the receiving end. There are exactly twenty — always
use these codes with these exact names:

| Code | Sector |
|---|---|
| `11` | Agriculture, Forestry, Fishing and Hunting |
| `21` | Mining |
| `22` | Utilities |
| `23` | Construction |
| `31-33` | Manufacturing |
| `42` | Wholesale Trade |
| `44-45` | Retail Trade |
| `48-49` | Transportation and Warehousing |
| `51` | Information |
| `52` | Finance and Insurance |
| `53` | Real Estate Rental and Leasing |
| `54` | Professional, Scientific, and Technical Services |
| `55` | Management of Companies and Enterprises |
| `56` | Administrative and Support and Waste Management and Remediation Services |
| `61` | Educational Services |
| `62` | Health Care and Social Assistance |
| `71` | Arts, Entertainment, and Recreation |
| `72` | Accommodation and Food Services |
| `81` | Other Services (except Public Administration) |
| `92` | Public Administration |

- Write each tag as a pair — `{ "code": "52", "name": "Finance and
  Insurance" }` — both fields, exactly as tabled above. The pill shows the
  name; the code rides the hover tooltip.
- **Tag the victims and the targets — never the tool.** The industries come
  from whoever was breached, attacked, exposed or ordered to respond: the
  hospital whose records leaked, the bank and the university whose systems
  were exploited, the agencies named in an emergency directive. A
  vulnerability in a tool does **not** inherit the tool-maker's industry: a
  vLLM flaw exploited at a bank and a university is `52` Finance and
  Insurance + `61` Educational Services — *not* the developers' sector,
  even though vLLM is made by software developers.
- **The maker's industry appears only when the maker is also a victim** —
  their own tool turned back on them. If a vLLM vulnerability is exploited
  to breach data at the vLLM developers themselves, `54` Professional,
  Scientific, and Technical Services applies — because they are the ones
  hit, not because they built it.
- A story may carry **many** industries or **none**. When no sector applies
  (a threat-actor profile with unnamed victims, a multi-industry CVE
  digest, an exploited tool with no named victim), **omit the field
  entirely** — the page shows a single dim `Unspecified` pill for those, so
  never write the string `"Unspecified"` yourself.
- When in doubt, leave it out: a wrong industry misleads the filter; a
  missing one just reads as Unspecified.

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

## Deep dives (`type: "deep-dive"`)

A **deep dive** is a long-form research piece — far too big for the feed's
expandable cards, so it lives on its own page and the feed carries only a
small amber card. It is a **two-file write**: one card item here (with
`"type": "deep-dive"` + a `slug`, and no `url`/`summary`/`details`/`links`),
plus the full body in `news/deep-dives.json`.

Deep dives are normally produced by a **dedicated agent** — the complete
step-by-step runbook for that job is **`DEEP-DIVE-INSTRUCTIONS.md`** in this
folder. If the daily feed must reference a deep dive without producing one,
add only the card exactly as that runbook's §1 specifies. The seven rules
above (full-file rewrite, newest-first, plain text, https-only URLs,
validate) apply to whatever you write.

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
9. Report what you published: the date, the number of stories, the
   count per category, and the industries you tagged.

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
- [ ] `version` is `3` (feed) and `1` (deep-dive library); `updated` equals
      the newest day's date.
- [ ] Days are newest-first; no duplicate dates; nothing older than 90 days.
- [ ] Every `url` and every `links[].url` starts with `https://`.
- [ ] Every `industry` entry is a `{ code, name }` pair from the NAICS
      table; items with no sector omit the field (never write
      `"Unspecified"` in the data).
- [ ] Every deep-dive card has a matching slug in `news/deep-dives.json`.
- [ ] No HTML or markdown in any string; no `_mock` key left behind.
- [ ] `node scripts/check.mjs` prints `daily brief feed OK` and finishes
      without `✗` errors.
