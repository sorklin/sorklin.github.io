# The Daily Brief — deep-dive agent instructions

You are writing a **deep dive** for The Daily Brief (`/news/`) on
sorklin.com: a long-form research piece into one topic — far too big for the
feed's expandable cards — that the site publishes on **its own generated
page**. This document is the complete runbook; you should not need anything
else. (The daily-feed writer has a separate runbook:
`AGENT-INSTRUCTIONS.md`. The design rationale lives in `README.md`.)

You never write HTML. The site generates the article page from data; your
entire submission is two JSON edits.

## What you touch

Exactly two files, both in `news/`:

```
news/news.json        the daily feed — you add ONE small card item
news/deep-dives.json  the deep-dive library — you add the full body
```

Nothing else. Work from the repo root (the folder that contains
`index.html`, `news/`, `assets/` and `scripts/`).

## What a deep dive looks like when published

- **In the feed:** a small amber card under the day it was published —
  `DEEP DIVE` badge, category badge, source, title, one-line TL;DR, and a
  "Read the deep dive →" link.
- **On its page:** `/news/deep-dive/?s=<slug>` renders the full piece —
  title, TL;DR standfirst, summary standfirst, the key-fact bullets, and
  every source as a labelled link that opens in a new tab.
- The feed card **ages out after 90 days** (the feed is trimmed), but the
  page stays live for as long as the library keeps the slug — which is why
  slugs must never be renamed or deleted.

---

## §1 The card — `news/news.json`

A deep-dive card is a normal feed item under the day it was published, with
`"type": "deep-dive"` and **no** `url`, `summary`, `details` or `links`
(the body is not duplicated in the feed):

```json
{
  "type": "deep-dive",
  "slug": "yandex-bot-traffic",
  "category": "security",
  "title": "Yandex data-center strikes collapsed bot traffic — but it was Yandex's own crawlers",
  "tldr": "The one-line hook, same rules as any tldr.",
  "source": "Sorklin Research"
}
```

Card rules:

- `slug` — lowercase-kebab (`[a-z0-9-]`), unique across the library, and
  **stable forever**. Choose it from the topic and keep it for any re-run.
- `title` — ≤ ~120 characters, plain text.
- `tldr` — one line that stands alone; it is all a scanning reader sees.
- `category` — `"ai"` or `"security"` (see *Choosing a category* below).
- `source` — who produced the dive; `"Sorklin Research"` for agent research.

## §2 The body — `news/deep-dives.json`

The library is **append-only** (`version: 1`, a `dives` array). Add your
dive as a new object — or, if a dive with the same slug already exists
(a re-run), replace that object in place:

```json
{
  "version": 1,
  "dives": [
    {
      "slug": "yandex-bot-traffic",
      "date": "2026-10-12",
      "category": "security",
      "title": "…same title as the card…",
      "tldr": "…same tldr as the card…",
      "summary": "The standfirst paragraph shown at the top of the page.",
      "details": [
        "Key-fact bullets, one fact per string.",
        "Preserve any CONFIRMED / REPORTED / UNVERIFIED confidence tiers exactly as filed."
      ],
      "links": [
        { "label": "Publication — what it is", "url": "https://…" }
      ],
      "source": "Sorklin Research"
    }
  ]
}
```

Body rules:

- `date` — the dive's publication date (`YYYY-MM-DD`,
  **America/New_York**). It must match the day the card sits under.
- `summary` — the page standfirst: what happened, who is affected, and why
  it matters. 1 short paragraph.
- `details` — the heart of the piece: one fact per string. Long bullets are
  fine; this is the deep-dive body. Never summarise away specifics —
  versions, CVE ids, names, numbers, timelines, response steps.
- `links` — **every** source consulted, primary first, each as
  `{ "label": "Publication — what it is", "url": "https://…" }`. Absolute
  `https://` URLs only; anything else is dropped by the renderer.

---

## §3 Choosing a category

- **`"ai"` — AI security.** Stories where AI is the target, the weapon or
  the incident: model breaches, prompt injection, agent misbehaviour,
  AI-powered attacks, the AI supply chain, AI security policy.
- **`"security"` — "regular" security.** The rest of the wire: breaches,
  CVEs, ransomware, advisories, threat actors, general cyber policy.
- A deep dive spanning both gets whichever is dominant.

## §4 Writing style

- Plain text only — never HTML or markdown in any string; it renders
  literally.
- Factual, past-or-present tense, no hype, no first person, no rhetorical
  questions, no exclamation marks.
- `tldr` survives without anything else; `summary` is the next layer;
  `details` carry the specifics.
- If the research distinguishes confidence levels (CONFIRMED / REPORTED /
  UNVERIFIED), keep those prefixes **verbatim** at the start of the bullet —
  the page shows them exactly as filed and readers rely on them.

## §5 If you're given a compiled report (markdown)

Deep-dive reports map 1:1 onto the body:

| In the report | In `deep-dives.json` |
|---|---|
| `# Deep Dive — …` heading | the topic; pick the `slug` from it |
| `#### N. Title` story heading | `title` (drop the leading number) |
| `**TL;DR:** …` | `tldr` |
| `**Summary:** …` | `summary` |
| `**Key facts**` bullets | `details` — one string per bullet, markdown stripped |
| `**Links**` list | `links` — `label` = the link's label text, `url` = the URL |
| the section it sits under (AI security / General cybersecurity) | `category` (`"ai"` / `"security"`) |
| the link marked "Primary" | first entry of `links` |

## §6 Submission procedure, step by step

1. Read `news/news.json` and `news/deep-dives.json`.
2. **Write the body**: append your dive object to `dives` (or replace the
   object with the same slug). Leave every other dive untouched.
3. **Write the card**: in the feed, find the day object for the dive's
   `date` and insert the card item into that day's `items` (first position —
   a deep dive leads the day). If the day doesn't exist yet, create
   `{ "date": …, "items": [ …card… ] }` and insert it at the **front** of
   `days` (the array is newest-first).
4. Re-sort `days` newest-first; drop any day older than 90 days; set the
   top-level `updated` to the newest day's date (feed `version` stays 3;
   library `version` stays 1).
5. Write **both files back in full** (read-modify-write; never partial
   JSON).
6. Validate from the repo root:

   ```
   node scripts/check.mjs
   ```

   It must print `✓ daily brief feed OK`, `✓ deep-dive library OK`, and
   finish with no `✗` errors. If it reports that a deep-dive slug has no
   library entry (or the reverse), fix the mismatch — that check exists
   precisely for this submission.

7. Report what you published: the slug, the title, the date, the number of
   key facts and sources, and which day the card sits under.

## §7 Final checklist

- [ ] Both files are valid JSON — no trailing commas, no comments.
- [ ] Feed `version` 3; library `version` 1.
- [ ] `slug` is lowercase-kebab, unique in the library, and identical in
      card and body.
- [ ] Card `date` = dive `date` = the day the card sits under.
- [ ] Every `url` and `links[].url` starts with `https://`.
- [ ] No HTML or markdown in any string; confidence tiers preserved.
- [ ] Feed days newest-first, no duplicate dates, nothing older than 90
      days.
- [ ] `node scripts/check.mjs` finishes without `✗` errors.
