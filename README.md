# The Sorklin Group — www.sorklin.com

The personal site of **Brendan Fitzpatrick**, CISSP, CRISC: VP of Product Management and Quantification
Modeling at [Axio](https://axio.com/), and product owner of the Axio quantification capability. The site covers
cyber risk quantification, security assessment, and the AI projects that keep getting built on the side.

A vanity site, deliberately: nothing here asks for a sale. The Axio relationship is disclosed on the page where
Axio gets praised, and it stays visible in corporate mode because that is a disclosure, not a joke.

No framework, no build step, no dependencies. Plain HTML + CSS + vanilla JS, committed straight to
`sorklin/sorklin.github.io` and served by GitHub Pages at **https://www.sorklin.com** (via `CNAME`).

---

## Run it locally

**No Node on this machine? Use PowerShell — it ships with Windows.** Nothing to install.

Double-click **`serve.cmd`**, or from PowerShell in this folder:

```
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

It opens <http://localhost:8080/> in your browser. `-Port 9000` for another port, `-NoOpen` to keep
the browser shut. `Ctrl-C` (or closing the window) stops it. To play Rolling Thunder without copying
~54 MB into this repo:

```
.\serve.ps1 -Assets D:\work\rthunder\app
```

Why a server at all: every page references `/assets/css/site.css` from the **root**, which is exactly
right for `www.sorklin.com` (the site sits at the domain root). Double-clicking `index.html` cannot
resolve that — on `file://` a leading `/` means your drive root, so you get an unstyled page. A local
server only has to answer root-absolute URLs the way the real domain does.

`serve.ps1` serves `index.html` for directories, sends `application/wasm` (Python's `http.server`
does **not**, and the emulator cares), never caches HTML, and returns the styled `404.html`. Like
`serve.mjs`, it is dev tooling: GitHub Pages never sees it.

### If you have Node

`node serve.mjs` does the same job (port as first argument; `--assets <dir>` and `--build <dir>`
for the game). Node is *only* ever dev tooling here — also used by `scripts/check.mjs` and
`scripts/package-rthunder.mjs`. One command if you want the whole toolkit:

```
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell afterwards so `node` is on the path.

---

## Check it before you push

Optional, and it needs Node — if you have no Node, skip this and go straight to pushing. The site is
static; nothing here is required for GitHub Pages to serve it.

```
node scripts/check.mjs
```

Verifies every required file exists, every internal `href`/`src` resolves, tags balance, JS parses,
the CNAME is right, and that nothing from the old Webflow export crept back in. Exits non-zero on errors.
Worth running as a pre-push habit; it takes about half a second.

The two warnings it will always print are on purpose: `projects/rthunder/play/probe.html` is a vendored
developer diagnostic and needs neither a viewport nor a description.

---

## Structure

```
index.html                     home
cyber-risk-quant/index.html    quantification: the argument, the work, the Axio360 section
cyber-security/index.html      assessments, frameworks, what you get
projects/index.html            the projects menu + workshop sketches
projects/dnd-shop/index.html   D&D Item Ledger (vendored single-file app)
projects/dnd-shop/README.md    the ledger's own manual, vendored from the dnd project
projects/rthunder/index.html   Rolling Thunder project page
projects/rthunder/BUILD-NOTES.md   how the MAME→WebAssembly build was made (vendored)
projects/rthunder/play/        the actual game page (patched upstream build)
projects/sorkgpt/index.html SorkGPT stub (sidebar, thread, composer, settings drawer)
about/index.html               about + the contact block
404.html                       GitHub Pages 404
assets/css/{site,chat}.css     design system and chat chrome
assets/js/{site,chat}.js       site behaviour and the chat client
assets/img/favicon.svg         mark
assets/img/linkedin.svg        LinkedIn glyph (verified simple-icons path; also inlined in the pages)
scripts/                       check.mjs, package-rthunder.mjs
serve.ps1 + serve.cmd          local preview server (PowerShell — no installs needed)
serve.mjs                      the same server for when Node is installed
robots.txt · sitemap.xml       crawler instructions
```

The nav and footer are **duplicated HTML in each page** — deliberate. This is a static site with no
templating and no build step; injecting them with JavaScript would give search engines and no-JS
visitors an empty page. If you change a nav item, change it in all pages
(`grep -l "nav-links" *.html */index.html */*/index.html` finds them).

---

## Publishing

Everything here is already in the working tree. From Windows, in this folder:

```
git status
git add -A
git commit -m "Redesign: static rewrite of the Sorklin Group site"
git push
```

GitHub Pages serves the push within a minute or two (Settings → Pages → Branch: `main` / root).
`CNAME` keeps `www.sorklin.com`; make sure your DNS `CNAME` record still points at
`sorklin.github.io` and "Enforce HTTPS" is on.

### Things deliberately left for you

1. **A public email, if you ever want one.** LinkedIn is the contact channel: a badge in the nav, one in every
   footer, and a large one on `/about/`. No contact form, no dead mailbox, no scraped address. The work address
   is deliberately unpublished. `TODO: a public email?` marks the one spot in `about/index.html` if a personal
   address should ever sit beside the badge.
2. **Corporate mode.** The footer toggle hides every joke and swaps in board-safe copy
   (`data-joke` / `data-corp` pairs, persisted in localStorage). The rule: **a joke that carries a fact needs a
   `data-corp` twin**, or corporate mode deletes the fact along with the punchline. Pure aphorism may stand alone.
   `node scripts/check.mjs` counts the pairs per page so drift stays visible.
3. **The employer disclosure.** The Axio section on `/cyber-risk-quant/` and the disclaimer on `/about/` are
   outside the joke toggle on purpose. If the role changes, edit both — and the `<title>`/`description` tags.
4. **The old Webflow site.** Removed from the working tree in this change (`static/`, `storage/`,
   `.DS_Store`, the old `index.html`). It stays in git history — `git show 671cdc6:index.html` gets the
   last version back if you ever want a screenshot of it.

---

## Rolling Thunder

The play page is real: MAME 0.277's Namco System 86 driver compiled to WebAssembly, ROM mounted in the
in-memory filesystem, save states and DIP switches working. What is **not** in this repo is the ~54 MB
of build payload (56 MB `rthunder.wasm` + glue + font + ROM + probe) — a website repo is the wrong place
for it, and the ROM belongs to Namco, not to me.

At boot the page resolves assets in this order:

1. `./assets/` next to the page — staged by `node scripts/package-rthunder.mjs --install-local`
   (git-ignored; this is the "just let me play it" path)
2. `RT_REMOTE_BASE` at the top of `projects/rthunder/play/index.html` — any origin that sends
   `Access-Control-Allow-Origin: *`
3. neither → a panel saying exactly what's missing and the command that fixes it

`node scripts/package-rthunder.mjs` also writes `manifest.json` (path, size, CRC32 per file). The play
page reads it and refuses to boot if the ROM it downloads doesn't match the manifest — a silently
truncated download otherwise shows up as a black canvas and a very bad afternoon.

### Making it playable from the internet (optional)

Keep the build repository **private** — it contains a licensed arcade ROM.

A browser cannot read a private GitHub repo directly: `raw.githubusercontent.com` answers the CORS
preflight for an `Authorization` header with `403` (verified 2026-09-28), so a token can never be attached
from the page. Put a ~15-line Cloudflare Worker in front — it holds the token as a secret and adds the CORS
header. Full worker code is in the "Hosting it publicly" section of `README.md` for the game build folder,
and the shape is identical to the one above.

### Known limits of this copy

- The `?engine=emulatorjs` fallback can't start from a staged build (the packer doesn't ship the EmulatorJS
  core or `roms/legacy/`); it runs from the original `app/` folder or a `file://` build.
- `?verify=1` POSTs to the upstream `app/server.js`, which Pages doesn't have.
- `probe.html` is a development page for the original folder; it will 404 its own fetch here.

---

## SorkGPT (stub, honestly labelled)

The interface is finished: sessions in localStorage, streaming render, markdown-lite, settings drawer,
connection tester, copy buttons, keyboard send. The **wire to Spark-I-Tron 6000 is not built**, and the page says
so in a banner rather than pretending.

It already speaks the OpenAI-compatible protocol — `POST <base>/v1/chat/completions` with SSE streaming,
plus a `/v1/models` probe in Settings. Point the Base URL at something real and the demo brain steps aside.

### TODO before this is useful

1. **An endpoint the browser may talk to.** Spark-I-Tron 6000 lives on the LAN and won't answer cross-origin
   requests from `www.sorklin.com`; exposing it directly would put an unauthenticated GPU on the internet.
   Put a small authenticating proxy in front and point the page at that.
2. **The family gate.** Access control belongs on that proxy, not in this file — anything a browser holds,
   a curious twelve-year-old can read. Options: a cookie issued by the proxy after a shared secret,
   Cloudflare Access in front of it, or HTTP Basic over TLS. Settings typed into the drawer persist in that
   browser's `localStorage` — fine for your household, not a security boundary.
3. **Model list.** `MODEL_HINTS` at the top of `assets/js/chat.js`. Free text on purpose, so this is
   cosmetic — but Spark-I-Tron 6000 should answer to something short.

---

## Conventions, if you add a page

- Copy the `<head>` block and the nav/footer from an existing section page; run `node scripts/check.mjs`
  afterwards — it will catch a broken link or an unbalanced `<div>` immediately.
- Colours, spacing and fonts are CSS custom properties at the top of `assets/css/site.css`. Don't hardcode hex.
- Anything animated must sit inside `@media (prefers-reduced-motion: reduce)` handling.
- Humour is a `data-joke` span with a `data-corp` sibling. Joke optional, sibling required if the sentence
  matters — corporate mode would otherwise delete the fact along with the punchline.
