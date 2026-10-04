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
the browser shut. `Ctrl-C` (or closing the window) stops it. Rolling Thunder loads from the committed
build in `projects/rthunder/play/assets/` — nothing extra to point at. To preview a *different* build
without staging it over the committed one:

```
.\serve.ps1 -Assets D:\work\rthunder\app
```

### Other devices on the network

Both servers bind **every interface**, so a phone, a tablet or another PC on the same network can
open the site — and play Rolling Thunder — at `http://<this-pc's-LAN-IP>:8080/`. The exact URLs are
printed at startup.

- `serve.mjs` (Node) can always do this; no admin rights involved.
- `serve.ps1` can too, but Windows (http.sys) lets a standard account bind `localhost` and nothing
  else. If the all-interfaces bind is refused it falls back to localhost-only and prints the
  one-time fix, run as Administrator once:
  `netsh http add urlacl url=http://+:8080/ user=DOMAIN\user`
- If a device still cannot connect, it is the Windows Firewall prompt — allow the port
  (`New-NetFirewallRule -DisplayName 'Sorklin site' -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow`).
- `-LocalOnly` restores the old localhost-only behaviour.

Why a server at all: every page references `/assets/css/site.css` from the **root**, which is exactly
right for `www.sorklin.com` (the site sits at the domain root). Double-clicking `index.html` cannot
resolve that — on `file://` a leading `/` means your drive root, so you get an unstyled page. A local
server only has to answer root-absolute URLs the way the real domain does.

`serve.ps1` serves `index.html` for directories, sends `application/wasm` (Python's `http.server`
does **not**, and the emulator cares), never caches HTML, and returns the styled `404.html`. Both
servers ship in the repo so anyone can run the project after a clone; GitHub Pages also serving them
as static files is harmless.

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
developer diagnostic and needs neither a viewport nor a description, and the committed 55 MB
`rthunder.wasm` triggers GitHub's own "over 50 MB" push nag (it is accepted; the hard limit is 100 MB).

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
projects/rthunder/play/assets/ the committed build: wasm core, ROM set, EmulatorJS fallback
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
in-memory filesystem, save states and DIP switches working. **And the build ships with the site**:
`projects/rthunder/play/assets/` holds the whole payload — the 56 MB `rthunder.wasm`, the glue and
bitmap font, the ROM set, and the EmulatorJS fallback runtime — committed next to the page. The site
is self-contained: GitHub Pages serves the game to anyone, the local servers serve it to the LAN, and
the page CRC-verifies every file against `manifest.json` before it will boot one (a silently truncated
download otherwise shows up as a black canvas and a very bad afternoon).

At boot the page resolves assets in this order:

1. `./assets/` next to the page — the committed copy (the normal path, works on every host)
2. `?remote=1`, or `RT_REMOTE_BASE` at the top of `projects/rthunder/play/index.html` — any origin that
   sends `Access-Control-Allow-Origin: *` (handy for testing a different build without staging it)

Re-staging after a rebuild of the core:

```
node scripts/package-rthunder.mjs --install-local --src D:\work\rthunder\app
```

That walks the source app folder, copies `wasm/`, `roms/` (including the 0.37b15-named legacy zip),
`emulatorjs/` and the boot probe into `play/assets/`, and rewrites `manifest.json` with size + CRC32
per file. Commit the result and push — the site is playable everywhere again.

### Why the build lives in the repo now

It used not to: the payload lived outside the site, because a website repo seemed the wrong place for
56 MB, and the plan was a private build repo fronted by a token-holding Cloudflare Worker — a browser
cannot read a private repo's raw URLs at all (`raw.githubusercontent.com` 403s the CORS preflight for
an `Authorization` header, verified 2026-09-28, so a token can never be attached from the page).
Shipping the files here deletes the whole dance: one repo, one push, playable on any client. The
arcade ROM's copyright belongs to its owner; it is included so the project runs — that decision is
this site owner's, and the emulator itself is home-grown.

### Known limits of this copy

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
