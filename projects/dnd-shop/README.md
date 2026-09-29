> **Vendored copy.** This is the manual for the hosted app at
> `/projects/dnd-shop/`. It is kept verbatim from the source project; the
> `research-results.json`, `descriptions/` and `smoke-test.js` it mentions live
> in that project, not on this site.

# 🐉 D&D Item Ledger

A **single-file, offline-first HTML app** for tracking D&D 5e item prices and your party's treasure:
what things are worth, what the party paid, where they found it, and what it sells for *here, now, to this
shopkeeper* — with multiplicative scalers (location, relationship, condition, …) and a sale-price-vs-buy-price ledger.

**Files**

| File | Purpose |
|---|---|
| `dnd-item-ledger.html` | The whole app. Copy it anywhere; open it in a browser. |
| `server.js` | Optional zero-dependency fallback server (only if `file://` storage is blocked). |
| `smoke-test.js` | Developer regression test (`node smoke-test.js`). |

Works on **Windows 11** (Edge or Chrome — Edge is fine and preinstalled) and **Mac** (Chrome/Edge recommended;
Safari works but is less tested). No installation, no internet required, no telemetry.

---

## Quick start (Windows 11)

1. Copy `dnd-item-ledger.html` anywhere (Desktop, `Documents\dnd\`, …).
2. Double-click it. It opens in your browser — done.
3. First launch stores data in that browser's **IndexedDB** — private to that browser profile, it does **not**
   leave the browser and can't be shared or synced. Want your data in a real file you control?
   **Settings ▸ Storage ▸ 📁 Link a data folder** (see *Where data lives* below). Backups: Settings ▸ Data ▸ Export.

If a banner says storage is unavailable in `file://` mode (rare; mostly older Firefox configs):
run `node server.js` in the folder and open **http://127.0.0.1:8787** instead.
⚠️ `file://` and `http://127.0.0.1:8787` are *different origins* with separate data — migrate once via Export/Restore.

## Where data lives: browser storage vs. data folder

**IndexedDB never leaves the browser** — it's per-browser-profile, invisible to file sync, and a browser
reset erases it. So the app supports **folder mode**, which flips storage to a plain JSON file on your disk:

* Settings ▸ Storage ▸ **📁 Link a data folder** → pick/create a folder (works great inside
  OneDrive / Dropbox / Syncthing / Resilient folders).
* From then on `dnd-ledger.json` in that folder **is the database** — every change autosaves within ~a second,
  and a daily copy lands in the folder's `backups/` subfolder. Open the same file from any PC (or the same
  PC after any browser change) by linking the folder again.
* After browser restarts, folder access needs **one reconnect click** (browser security rule) — the app
  reminds you; until you click, the folder file is left untouched and the tab uses browser storage.
* One caveat of file-synced setups: **last save wins** — use one machine at a time.
* Requires Chrome/Edge (File System Access API). On Safari/Firefox the app stays on IndexedDB + Export/Import;
  “Unlink folder” always switches back cleanly (data is copied both directions automatically).
* The sidebar shows which mode you're in: `📁 folder-name` = live autosaving to your file.

## The pricing model

```
sale price = base value × scaler₁ × scaler₂ × … × sale %      (rounded, mode configurable)
```

* **Base value** — catalog value, or what the party actually paid.
* **Scalers** (Settings ▸ Scalers) — percent multipliers you define: `Neverwinter 120%`,
  `Friend of the shop owner 90%`, `Worn condition 70%`. Each has a “default on” flag; you tick them per sale.
  Each also has **per-category coverage**: untick the categories a scaler shouldn't touch (a black-market
  bonus that applies to trade goods but not magic items). All ticked = applies to everything (the default).
  Everywhere a scaler is offered — Sell, the **Buy** dialog, suggested sale prices — scoped-out scalers are
  hidden and never counted. Past sales keep their snapshot regardless.
* **Sale %** — how much of the (adjusted) buy price a buyer offers. **No default is hardcoded**: set it per
  category (mundane, consumables, magic items, gems/jewelry, trade goods, or your own) in Settings ▸ Categories.
  The Sell screen blocks until a % is available (or you type one inline).

### Quoting prices from the tables

Both the Catalog and the Inventory toolbar have a **⚙ Scalers (n on)** dropdown: tick the scalers you're
"at" right now (default-on ones start ticked; *reset to defaults* restores that). The whole **price column**
recomputes — `base × applicable scalers`, honoring each scaler's category coverage, original struck through —
and stays sortable by the quoted figure. The profile is shared between the two screens, and it also feeds
Inventory's *suggested sale* column, so one dropdown describes “the market right now”.

The Inventory toolbar additionally has a **sale %** box: whatever you type there overrides the category
default % for the suggested-price column only (blank = defaults; the Sell screen and saved sales are
unaffected). E.g. haggling night: type `35` and watch every held item's suggestion drop to 35%.

Example: a treasure paid for **1,000 gp**, sold in Neverwinter (**120%**) to a friendly merchant (**90%**)
with magic-item sale rate **50%** → `1000 × 1.2 × 0.9 × 0.5 = 540 gp`, profit `−460 gp` vs. paid.
Every sale **snapshots** its inputs, so later scaler edits never rewrite history.

Money parses freely: `550`, `550 gp`, `55 gp 5 sp`, `1,250 gp`, `2 pp`, `25 sp` all work (cp/sp/ep/gp/pp).

**Display mode** (Settings ▸ Value display), default **Gold**: numbers show in gp with fractions kept and
calculated (`Wine = 0.1 gp`). Switch to **Coins** and everywhere shows only the *nonzero* denominations:
`30 gp → 3 pp`, `6.26 gp → 6 gp 2 sp 6 cp`, `50.02 gp → 5 pp 2 cp`, `1 sp → 1 sp`. **Simple coins** is the
same but never carries into platinum: `55.23 gp → 55 gp 2 sp 3 cp`. Entry boxes always
accept either style; in Gold mode the item detail also shows the coin breakdown as a hint, and CSV exports
stay numeric gp regardless of display mode.

**Rounding** (same panel): toggle *round the final sale price* **off** to keep exact fractions, or **on** with
a **unit** — copper (0.01), silver (0.1), gold (1), platinum (10 gp) — and a **direction** (nearest / up / down).
Default is on + gold + nearest, matching the old behavior: `1000 × 120% × 90% × 50% = 540 gp` is unchanged.

## Screens

* **Catalog** — searchable item database (577 seed items: PHB gear, trade goods, gems — plus **481 magic
  items seeded from the Dump Stat Adventures pricing sheet**, each carrying its pricing factors so its price
  is live-recomputed from the model; see *Magic item pricing model*). Description column,
  clickable source links (any URL in the source field becomes a 🔗, e.g. a D&D Beyond page). **✓ button**
  clears a `verify` flag in one click; the **Buy** button (a bag icon, last column) opens the buy dialog. Column-header sorting and
  category/rarity/provenance filters. Import/export CSV, inline editor. Clicking a row opens its detail
  card at the bottom of the list; close it with the **×** at the card's upper right, by clicking the row
  again, or with **Esc** — all three leave the table in the same state, with the row's highlight gone.
* **Inventory** — the party's owned items (found *or bought*): paid amount, found/bought where/when, tags;
  shows each held item's *suggested sale price* using your quote profile + category sale % (or the sale-%
  override box). Sortable columns, status/category filters, **Sell** button per held item, 🗑 delete —
  deleting is also how you remove lost/stolen items (the old “lost” status was retired; legacy `lost`
  entries convert to deleted on next launch).
* **Sell modal** (from any held item) — Price breakdown on the left (base → each scaler → adjusted → ×% →
  final, profit vs paid) with the scaler ticks under it; the form on the right (item switcher, base, sale %,
  buyer, location, date). The Record button shows the live total; **Cancel** or clicking outside closes
  without saving. (No separate Sell screen anymore — it was pure screen-hopping.)
* **Buy** — from any catalog row: quantity × (base × scalers) with live total; records the purchase in the
  ledger *and* puts it in inventory at the paid unit price, so later sale math can compare paid vs sold.
  (DM mistake-proofing: it catches charging too much *or* too little.)
* **Ledger** — every sale **and purchase**, with full math trail, qty, sold-vs-paid totals, type filter,
  sortable columns, CSV export, per-row undo (undoing a purchase also removes the inventory copy it made).
* **Research** — request box on top, review cards in the middle, local-LLM **chat box** at the bottom (see below).
* **Pricing** — the magic item pricing model: every scalar, rarity tax, material surcharge and condition
  price is editable here, with a factor catalog and a one-click **validation panel** that re-verifies all
  481 seeded sheet prices against the current parameters (see below).
* **Settings** — themes, scalers, categories & sale %, LLM connection, Google Sheet URL, **Storage**, display, backups, self-test.

## Themes — colours, fonts, backgrounds

**Settings ▸ Themes & appearance** heads the settings screen. A theme is simply the set of colours, fonts
and states the app paints with, saved so you can come back to it. The whole look runs off CSS custom
properties, so a theme reaches every corner of the UI — tables, badges, dialogs, toasts, the sidebar.

| Control | What it does |
| --- | --- |
| a theme card | switch to that theme at once; its card gains an **in use** badge |
| **✎ Edit** | open every attribute of that theme, with live preview |
| **⧉ Duplicate** | copy it — the copy is yours to change, the original stays stock |
| **🗑 Delete** | remove a custom theme (built-ins can't be deleted; duplicate one first) |
| **＋ New theme…** | start from the theme in use and step straight into editing it |

Eight themes ship, so the current look is one choice among several rather than the only one:
**Ledger brass** (the original), **Midnight** (Nord), **Evergreen** (Everforest), **Rosé Pine**, **Gruvbox**,
**Solarized Light**, **Parchment** (warm paper, serif) and **High Contrast** (black, white, yellow).

The editor lists every attribute the stylesheet actually reads, grouped Background / Surfaces / Text /
Accents / States / Shape: page, sidebar and card surfaces, borders and row rules, main and muted text, the
text that sits on accent buttons, status colours, row hover and selection, the search highlight and its
text, the warning banner, the modal veil, an optional **background image** (any URL — fitted to the window
and fixed while you scroll), the interface and number fonts, text size, and corner radius. Colour rows
carry a live **WCAG contrast ratio** against the surface they are painted on; 4.5:1 and above is green,
below 3:1 red.

Two escape hatches while editing:

* **✨ Re-derive tints & keep text legible** rebuilds the derived states — hover, selection, highlight,
  error tints, text-on-button — from the colours you just chose, then nudges anything that fell below
  4.5:1 back over the line. Change the accent and the whole theme follows.
* **Restore stock values** returns every attribute to the original look.

Nothing is written until **Save**: **Cancel** restores exactly what was on screen before you opened the
editor (and discards a brand-new theme outright), and **Revert** undoes your edits mid-session without
closing the dialog. Saving stores only the attributes that differ from stock, so themes stay lean and
inherit future defaults. A custom theme is snapshotted when duplicated, so editing a copy can never touch
the original.

Themes live in settings, so they ride along in **Settings ▸ Data ▸ Export** and reappear where you restore
the backup. Upgrading the app tops the list up with any newly built-in theme and leaves your edits and
custom themes alone; deleting the theme in use falls back to the stock look.

## Magic item pricing model (factor-based)


The 481 seeded magic items are priced by the factor model of the **MagicItemPricing v1.2** Google Sheet
(Dump Stat Adventures — DMG 2014, XGTE and TCoE tabs; its Homebrew items are deliberately excluded):

```
price = ROUNDUP( Σ factor-costs × rarity-tax × (attunement ≠ Yes ? 1.1 : 1), 0 )
```

* **Factors** (about 20): materials & armor base, AC / saving-throw / weapon bonuses (each on a ×1/×3/×6
  ladder), ability-score costs, spell effects on a triangular ladder (`30·(lvl+1)(lvl+2)/2`, cantrip = 0),
  recurring charges (`spell × min(4 + charges/day − 1, 10)` minus the included first use; unlimited → ×10),
  charges-until-destroyed, shared-charge spell lists, 15 conditions, consumable/semi-permanent/permanent
  damage, HP restore, and misc. Items carry these inputs (shown by their sheet column letters) and the
  item editor exposes them all with a live `= X gp` preview.
* **Notes vs description**: the sheet's `based: …` reference line (which spell the pricing was derived
  from) lives in each seeded item's **notes** field — searchable, and always shown as the **Notes** field
  in the item detail card (`—` when an item has none) — while the item **description** is yours to fill in
  (see *Official descriptions* below). The `based: …` move is a **one-time migration**: the first boot that
  finds nothing sheet-shaped left in a description sets `settings.notesMoved` and the code never runs again,
  so an official or hand-written description can never be swept into notes by a later load.
* **Everything numeric is editable** in the 💎 Pricing tab — scalars, the rarity tax table (artifact has
  no sheet tax; add one there if you price artifacts), material surcharges, the condition table, the bonus
  ladder and the non-attunement scaler. *Reset to sheet defaults* restores the originals.
* **Live prices**: catalog, detail, quotes and the buy dialog show the *computed* price (with a ⚙ badge; a
  struck-through saved value appears when it differs). The saved `base value` syncs to the formula when you
  save the item — nothing rewrites your database behind your back, and past sales keep their snapshots.
* **Validation**: the Pricing tab compares the engine against all 481 prices as published on the sheet
  (`✔ all 481` with unedited parameters). After you tune a scalar, the panel lists exactly which items
  moved and by how much — the same checks run in `node smoke-test.js` and the in-app self-test.
* **Quirks faithfully reproduced** (they are the sheet's): non-attuned items cost +10%; the armor base
  counts again inside the AC-bonus cost; a blank “charges/day” counts as zero (⇒ 3× a single use);
  save-allowed damage costs 25% *less*; a blank Y/N next to damage means the sheet ignores that damage.
* **Regenerating the seed** (if the sheet changes): keep the tooling in `.sheet-cache/` — download the
  workbook as xlsx while the sheet is link-readable (`…/export?format=xlsx`), then
  `node xlsx2json.mjs pricing.xlsx data && node gen-seed.mjs` and paste `seed-sheet.gen.js` over the
  `SEED_SHEET` block in the HTML. The app itself never needs the sheet — the data ships embedded.

## Getting data in

1. **CSV paste/upload** (Catalog ▸ Import CSV ▸ *Map columns*). Column mapping is auto-guessed, shown, and
   fixable; you preview new/changed rows and tick exactly which fields to apply. Nothing is written until you confirm.
2. **🪄 Smart import — any messy text** (same dialog): paste wiki dumps, bullet lists, mangled exports and hit
   *Organize with LLM* — your local model normalizes it into item records, which land in the same
   preview-diff UI, marked `llm` + `verify`. Nothing is written until you approve the diff.
3. **Google Sheet live sync** — in Google Sheets: *File ▸ Share ▸ Publish to web ▸ (sheet) ▸ CSV*, paste the
   URL into Settings ▸ Google Sheet, then “Sync now” (same confirm-before-write diff preview). Published CSVs
   are served with CORS headers, so this works from the browser. “Download as CSV” + Import always works too.
4. **LLM research** — see below.
5. **Provenance is tracked** on every item (`seed / manual / csv / sheet / llm / verified`) and the
   `verified` flag stops imports from silently overwriting fields you've personally checked — the ✓ button
   in the table marks an item verified without opening anything.

## Local LLM hookup

Settings ▸ Local LLM: **Base URL** (e.g. `http://localhost:1234/v1`), API style
(**chat completions** `/chat/completions` or **responses** `/responses`), model name, optional key (stored
only in this browser). The app asks for strict JSON `{name, category, rarity, baseValueGp, description, sources}`;
replies are shown as a **diff** and only applied field-by-field, marked `llm` + `verify`.

The browser→localhost call needs CORS enabled on your server (one-time):

| Server | Enable CORS |
|---|---|
| LM Studio | Server tab → CORS toggle (or `LMSTUDIO_SERVER_CORS=1`) |
| Ollama | `set OLLAMA_ORIGINS=*` (Windows) / `OLLAMA_ORIGINS=* ollama serve` |
| llama.cpp | run `llama-server --cors` |
| vLLM | `--allow-origins '*'` |

## Research tab: request cards on top, chat at the bottom

1. **🔎 Research by name** — just the item name (catalog-search or free text) + the wanted fields (+ the
   *Item fields* toggle that requires the JSON schema). Press **Research** and the request fires **in the
   background** — not through the chat box — while a stub item card appears below with an
   **⏳ researching…** badge and a ⏹ Stop button. The name you typed is cleared from the input. When the
   answer arrives (or you stop it), the card fills in — whatever the model found, merged over what you
   typed — and shows ✔ Accept / ✕ Reject (plus 🔄 Retry).
2. **🧾 Parse item information** — paste *anything* (wiki dump, inscription, ledger line). Press
   **Parse** and it fires a background "parse this into the item fields" request: fields it can't determine
   stay blank, and anything it can't place — or that reads like item lore — goes into the **description
   verbatim**, with instructions never to rephrase or drop important content. Same stub-card lifecycle and
   the pasted text is collapsible on the card for reference. Input clears on press.
3. **📥 Item records** — every stub/request card, newest on top; each stays until accepted or rejected.
   Fields are editable in place before Accept; Accept writes to the **catalog** (`llm` + **verify** tags),
   updating the linked catalog item when the name matches one (one-click unlink). Item JSON returned in the
   chat, or imported results files, land here as cards too.
4. **🤖 Local LLM chat** — free-form chat against your configured endpoint, streaming token-by-token,
   Enter sends / Shift+Enter newline / ⏹ Stop. The system prompt teaches it the item schema, so "parse
   this: …" in the chat also produces review cards. History lives for the tab session.

**Advanced (collapsed): the DSH file-protocol queue.** Local models can't browse, so for web-backed research
the app hands batches to an agent with web tools (DSH). Three handoff styles, all producing the same
`research-results.json` answers keyed by `requestId`:

* **📦 Copy DSH handoff package** (recommended) — one paste contains *everything*: instructions + the whole
  queue JSON inline + the reply format. Paste into a DSH chat; paste its answer back into the **Import
  pasted** box. Zero files.
* **Folder mode** (Settings ▸ Storage): **⤓ Write research-requests.json** drops the queue next to
  `dnd-ledger.json` where a DSH session on the same machine can read it; the agent writes
  `research-results.json` there, and the app picks it up via **🔄 Pick up** — or automatically at startup —
  then archives the file as `research-imported-<timestamp>.json` so nothing double-imports.
* **⬇ Download** the request file for machines the agent can't see, and **⬆ Import results file** after.

Queue work with **＋ Queue request** or 🔍 on any catalog row; empty-queue warnings included everywhere.
Successful results land in **📥 Item records** like everything else — when a result names an existing
catalog item it becomes an *update card*: every field it would change shows the current value ("was: …")
and the header counts the changes; blank fields never overwrite anything, and Accept with no differences
just closes the card. Failed lookups stay in the queue table with their error note.

When **two or more** cards are waiting, the section header grows a **✔ Accept all (N)** and a
**✕ Reject all (N)** pair. Accept all applies each card exactly as if you had pressed its own Accept —
whatever is in the card's fields at that moment, one card at a time — and a card whose name or value is
blank or unparseable is left open instead of guessing; the closing toast says how many went in and how
many stayed. Past 20 cards it asks first, and Reject all always asks, because it discards the cards
without writing anything. A card still waiting on its research/parse is never counted in either button.

## Official descriptions (bulk D&D Beyond pass)

The seeded pricing-sheet items arrive with an empty **description** field. `descriptions/` holds the
one-off tooling that filled it from D&D Beyond's compendium, and it doubles as the way to re-run the pass
when the catalog grows:

| Step | Command | What it does |
|---|---|---|
| 1 | `node descriptions/extract.mjs` | Reads the seed item list out of `dnd-item-ledger.html` → `worklist-seed.json` / `worklist-mundane.json` |
| 2 | `node descriptions/make-batches.mjs 30` | Dedupes names into `batches/batch-NN.json` (also feeds the agent slices) |
| 3 | `node descriptions/ddb-fetch.mjs index` | Pages D&D Beyond's magic-item and equipment listings into `cache/index.json` (~1,200 + ~3,700 entries) |
| 4 | `node descriptions/ddb-fetch.mjs resolve` | Matches each ledger name onto an entry via a rule ladder (`resolved.json`, rule recorded per item) |
| 5 | `node descriptions/ddb-fetch.mjs fetch` | Fetches each unique page and extracts the description verbatim (resumable; `cache/pages/`) |
| 6 | `node descriptions/ddb-fetch.mjs repair` | Re-points items whose page came back empty or was flagged wrong by an audit, using entries D&D Beyond's own filter names identically |
| 7 | `node descriptions/build-results.mjs` | Writes `research-results.json` (the app's file protocol), `skipped.json`, and `manifest.json` |

Extraction rules live in `descriptions/lib-extract.mjs` and are deliberately conservative: the page text is
copied as published — book tables become `Label: value` lines, D&D Beyond's own armor/weapon applicability
matrices and "Type / Cost / Weight" headers are dropped, and a page that serves only marketing chrome counts
as “no description” rather than guessing. Item names that D&D Beyond spells differently (“Hat of Wizardy” →
*Hat of Wizardry*) or folds into a combined entry (*Potions of Healing*, *Ioun Stone*) are matched to the
base entry; a name with no entry at all (DMG trade-goods lines such as *Ivory Statuette*) is **left as is**.
The pass needs the `ddb-mcp` session (`HOME=/home/node/.dsh/ddb-home`), and nothing in it writes to the
ledger: results are applied only through the app's own Research ▸ Pick up / Import results diff.

## Safety notes

* Everything stays on your machine. The only network requests the app ever makes: your configured LLM
  endpoint, and the Google Sheet URL you publish — both only when you click something.
* The 25-write “no backup yet” nudge is a reminder, dismissible, never auto-sends anything.
  (Folder mode disables the nudge — your folder *is* the backup, with daily `backups/` copies.)
* Settings ▸ Advanced ▸ **Run self-test** checks money parsing, scaler math (incl. the 1000×120%×90%×50%=540
  case and buy math 1000×120%×90%×3=3240), CSV quoting, JSON extraction, import normalization, table
  sorting, snapshot immutability, and the pricing model (spot prices + reproduction of all 481 seeded
  sheet prices) in your actual browser.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Storage banner on launch | Settings ▸ Storage ▸ link a data folder, or `node server.js` fallback, or Chrome/Edge |
| “needs a one-click reconnect” after restart | Settings ▸ Storage ▸ Reconnect folder (browser security, once per session) |
| Two machines editing the linked folder | Last save wins — work on one at a time, or restore from `backups/` |
| LLM test: “network/CORS blocked” | Enable CORS on the server (table above) |
| Smart import returns nothing | Paste smaller chunks, or use a stronger local model; or “Map columns” for CSV-shaped text |
| Sheet sync: “returned HTML” | You linked the normal sheet URL — use Publish to web ▸ CSV |
| Item shows ⚠ instead of a price | Its rarity tax, condition or material was removed from the Pricing tab — hover the ⚠ for the reason, add the entry back, or price the item manually |
| Catalog price ≠ saved base value | The item is priced by formula and the saved value is stale — open the item and Save to sync (⚙ badge = live formula price) |
| Sheet sync: failed to fetch | Sheet isn't public yet, or “anyone with link ▸ viewer” isn't set |
| Lost data after browser reset | Linked folder: reconnect the folder (nothing was lost). Otherwise restore newest `dnd-ledger-backup-*.json` |
