#!/usr/bin/env node
/* check.mjs — pre-push sanity checks for a site with no build step to catch mistakes.
   Run: node scripts/check.mjs          (exit 1 = something to fix)            */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE = new Set([".git", "node_modules", "dist", "legacy-site"]);

let errors = 0, warnings = 0;
const bad = (m) => { console.log("  ✗ " + m); errors++; };
const warn = (m) => { console.log("  ! " + m); warnings++; };
const good = (m) => console.log("  ✓ " + m);
const note = (m) => console.log("  · " + m);

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!IGNORE.has(e.name)) walk(path.join(dir, e.name), out); }
    else out.push(path.join(dir, e.name));
  }
  return out;
}
const files = walk(ROOT, []).filter((f) => !f.includes("legacy-site"));
const htmlFiles = files.filter((f) => f.endsWith(".html"));

console.log("\n  Sorklin site check\n  " + "─".repeat(40));

/* 1. required pieces ---------------------------------------------------- */
// serve.ps1 / serve.cmd / serve.mjs are validated separately (5b) rather than
// listed here, so the checker still runs on a tree where they have not been
// checked out yet. They are committed, like everything else someone needs to
// run the project.
const localOnly = ["serve.ps1", "serve.cmd", "serve.mjs"].filter((f) => !existsSync(path.join(ROOT, f)));
const required = [
  "index.html", "404.html", "CNAME", "README.md", "robots.txt", "sitemap.xml",
  "assets/css/site.css", "assets/js/site.js", "assets/img/favicon.svg",
  "cyber-risk-quant/index.html", "cyber-security/index.html", "projects/index.html",
  "projects/dnd-shop/index.html", "projects/rthunder/index.html",
  "projects/rthunder/play/index.html", "projects/sorkgpt/index.html",
  "about/index.html", "news/index.html",
];
const missing = required.filter((r) => !existsSync(path.join(ROOT, r)));
if (missing.length) missing.forEach((m) => bad("missing required file: " + m));
else good(`${required.length} required files present`);
if (localOnly.length) note(`local tooling absent, fine if gitignored: ${localOnly.join(", ")}`);

/* 2. per-page checks ---------------------------------------------------- */
// Script and style bodies are stripped before any HTML analysis: template
// strings inside the vendored apps otherwise look like unbalanced markup and
// like links (they are neither).
const STANDALONE = [
  "projects/dnd-shop/index.html",   // vendored single-file app, own chrome
  "projects/rthunder/play/index.html", // game page: full-viewport, no site chrome
  "projects/rthunder/play/probe.html", // developer diagnostic
];

let links = 0, external = 0;
for (const f of htmlFiles) {
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  const rawSrc = readFileSync(f, "utf8");
  const src = rawSrc.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const standalone = STANDALONE.includes(rel);

  // attributes written wrong (a stray quote silently breaks the rest of a tag)
  if (/data-scramble"/.test(rawSrc)) bad(`${rel}: malformed attribute 'data-scramble"'`);
  if (/class=[^\s>"']+[^\s>]*/.test(src)) warn(`${rel}: unquoted class attribute somewhere`);

  // structural balance for containers that wreck layout when unbalanced
  for (const tag of ["div", "section", "article", "main", "aside", "header", "footer", "nav", "table", "ul", "ol"]) {
    const open = (src.match(new RegExp("<" + tag + "(?=[\\s>])", "g")) || []).length;
    const close = (src.match(new RegExp("</" + tag + ">", "g")) || []).length;
    if (open !== close) bad(`${rel}: <${tag}> opens ${open}× but closes ${close}×`);
  }

  // required head pieces
  if (!/<title>[^<]{3,}<\/title>/.test(rawSrc)) warn(`${rel}: no useful <title>`);
  if (!/name="viewport"/.test(rawSrc)) warn(`${rel}: no viewport meta`);
  if (!/name="description"/.test(rawSrc)) warn(`${rel}: no meta description`);
  if (!standalone && !/<link rel="stylesheet" href="\/assets\/css\/site\.css">/.test(rawSrc)) {
    warn(`${rel}: site.css not linked`);
  }

  // internal references must resolve
  for (const m of src.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    const raw = m[1];
    if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(raw)) { external++; continue; }
    if (!raw.trim()) continue;
    links++;
    const clean = raw.split("?")[0].replace(/\/$/, "");
    const target = clean.startsWith("/")
      ? path.join(ROOT, clean)
      : path.resolve(path.dirname(f), clean);
    if (!existsSync(target)) {
      // a directory URL is fine if its index.html exists
      if (!existsSync(path.join(target, "index.html"))) bad(`${rel}: broken link → ${raw}`);
    } else if (statSync(target).isDirectory() && !existsSync(path.join(target, "index.html"))) {
      bad(`${rel}: link → ${raw} is a directory with no index.html`);
    }
  }
}
good(`${htmlFiles.length} HTML pages · ${links} internal links resolved · ${external} external links left alone`);

/* 3. javascript parses -------------------------------------------------- */
for (const f of files.filter((x) => /\.(js|mjs)$/.test(x) && !x.includes("play/index.html"))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { bad(`${path.relative(ROOT, f)}: ${String(e.stderr || e.message).split("\n").slice(0, 3).join(" ")}`); }
}
good("all .js / .mjs files parse");

/* 4. stylesheet braces -------------------------------------------------- */
for (const f of files.filter((x) => x.endsWith(".css"))) {
  const s = readFileSync(f, "utf8");
  const o = (s.match(/\{/g) || []).length, c = (s.match(/\}/g) || []).length;
  if (o !== c) bad(`${path.relative(ROOT, f)}: ${o} "{" vs ${c} "}"`);
}
good("css braces balance");

/* 5. leftovers from the previous Webflow build -------------------------- */
for (const stale of ["static", "storage", ".DS_Store"]) {
  if (existsSync(path.join(ROOT, stale))) warn(`leftover from the old site still in the tree: ${stale}/`);
}
if (!/www\.sorklin\.com/.test(readFileSync(path.join(ROOT, "CNAME"), "utf8"))) bad("CNAME does not say www.sorklin.com");
else good("CNAME → www.sorklin.com");

/* 5b. host tooling must survive Windows PowerShell 5.1 ------------------ */
// PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so a single em dash in a
// comment arrives as mojibake. Keep serve.ps1 pure ASCII; the checker enforces it
// because that corruption is invisible on a Linux box.
const ps1Path = path.join(ROOT, "serve.ps1");
if (existsSync(ps1Path)) {
  const s = readFileSync(ps1Path, "latin1");
  const odd = [...s].filter((c) => c.charCodeAt(0) > 126);
  if (odd.length) {
    warn(`serve.ps1: ${odd.length} non-ASCII char(s) (${odd.slice(0, 6).join("")}) - Windows PowerShell 5.1 will read them as ANSI mojibake`);
  }
  if (!/\r\n/.test(s)) warn("serve.ps1: no CRLF line endings; PowerShell runs it fine, Notepad edits get messy");
}
const cmdPath = path.join(ROOT, "serve.cmd");
if (existsSync(cmdPath)) {
  const s = readFileSync(cmdPath, "latin1");
  if (!/-ExecutionPolicy\s+Bypass/.test(s)) bad("serve.cmd: no -ExecutionPolicy Bypass, so double-clicking refuses to run serve.ps1");
  if (!/serve\.ps1/.test(s)) bad("serve.cmd: does not reference serve.ps1");
}

/* 5c. the daily brief feed ---------------------------------------------- */
// /news/ is written daily by a separate process through news/news.json (the
// contract lives in news/README.md). Validate that machine contract here so
// a bad write is caught pre-push instead of on the page.
const newsJsonPath = path.join(ROOT, "news", "news.json");
const diveRefs = []; // { slug, date } — cross-checked against news/deep-dives.json below
if (!existsSync(newsJsonPath)) {
  warn("news/news.json absent — the Daily Brief has nothing to render");
} else {
  try {
    const feed = JSON.parse(readFileSync(newsJsonPath, "utf8"));
    if (typeof feed !== "object" || feed === null || Array.isArray(feed)) throw new Error("root must be an object");
    if (feed.version !== 3) {
      throw new Error("version must be 3 (schema v3: items may carry type:\"deep-dive\" + slug; deep-dive bodies live in news/deep-dives.json)");
    }
    if (feed.updated !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(feed.updated))) {
      throw new Error("updated must be null or YYYY-MM-DD");
    }
    if (!Array.isArray(feed.days)) throw new Error("days must be an array");
    const seen = new Set();
    let itemCount = 0, prev = null;
    feed.days.forEach((d, i) => {
      if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error(`days[${i}] must be an object`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ""))) throw new Error(`days[${i}].date must be YYYY-MM-DD`);
      if (seen.has(d.date)) throw new Error(`duplicate day ${d.date}`);
      seen.add(d.date);
      if (prev && d.date > prev) throw new Error("days must be newest-first (dates descending)"); // ISO strings sort
      prev = d.date;
      if (!Array.isArray(d.items)) throw new Error(`days[${i}].items must be an array`);
      d.items.forEach((it, j) => {
        if (!it || typeof it !== "object") throw new Error(`days[${i}].items[${j}] must be an object`);
        if (typeof it.title !== "string" || !it.title.trim()) throw new Error(`days[${i}].items[${j}].title missing`);
        const isDive = it.type === "deep-dive";
        if (it.type !== undefined && !isDive && it.type !== "story") {
          warn(`days[${i}].items[${j}].type "${it.type}" is unknown — rendering as a regular story`);
        }
        if (isDive) {
          if (typeof it.slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(it.slug)) {
            throw new Error(`days[${i}].items[${j}].slug must be lowercase-kebab for a deep-dive item`);
          }
          diveRefs.push({ slug: it.slug, date: d.date, where: `days[${i}].items[${j}]` });
        } else if (typeof it.url !== "string" || !/^https?:\/\//i.test(it.url)) {
          throw new Error(`days[${i}].items[${j}].url must be an absolute http(s) URL`);
        }
        if (it.tldr === undefined || it.tldr === null) warn(`days[${i}].items[${j}] has no tldr (it shows collapsed under the title)`);
        else if (typeof it.tldr !== "string") throw new Error(`days[${i}].items[${j}].tldr must be a string`);
        if (!isDive && (typeof it.summary !== "string" || !it.summary.trim())) warn(`days[${i}].items[${j}] has no summary`);
        if (typeof it.source !== "string" || !it.source.trim()) warn(`days[${i}].items[${j}] has no source name`);
        if (it.details !== undefined && !Array.isArray(it.details)) throw new Error(`days[${i}].items[${j}].details must be an array of strings`);
        it.details?.forEach((x, k) => {
          if (typeof x !== "string" || !x.trim()) throw new Error(`days[${i}].items[${j}].details[${k}] must be a non-empty string`);
        });
        if (it.links !== undefined && !Array.isArray(it.links)) throw new Error(`days[${i}].items[${j}].links must be an array`);
        it.links?.forEach((l, k) => {
          if (!l || typeof l !== "object") throw new Error(`days[${i}].items[${j}].links[${k}] must be an object`);
          if (typeof l.url !== "string" || !/^https?:\/\//i.test(l.url)) {
            throw new Error(`days[${i}].items[${j}].links[${k}].url must be an absolute http(s) URL`);
          }
          if (typeof l.label !== "string" || !l.label.trim()) warn(`days[${i}].items[${j}].links[${k}] has no label (the raw URL shows instead)`);
        });
        if (it.category !== "security" && it.category !== "ai") {
          warn(`days[${i}].items[${j}].category "${it.category}" is not security|ai — it renders under a neutral "News" tag`);
        }
        itemCount++;
      });
    });
    if (feed.days.length > 90) warn(`feed holds ${feed.days.length} days — the writer process trims to 90 (news/README.md)`);
    good(`daily brief feed OK: ${feed.days.length} day(s), ${itemCount} item(s)`);
    // The new-tab rule is enforced in the renderer; make sure it stayed there.
    const newsJsPath = path.join(ROOT, "assets", "js", "news.js");
    if (existsSync(newsJsPath) && !/_blank/.test(readFileSync(newsJsPath, "utf8"))) {
      bad("assets/js/news.js: the renderer no longer opens publisher links in a new tab");
    } else {
      good("publisher links open in a new tab (renderer enforces _blank)");
    }
  } catch (e) {
    bad("news/news.json: " + e.message);
  }
}

/* 5d. the deep-dive library --------------------------------------------- */
// Long-form deep dives live in news/deep-dives.json (append-only; never
// trimmed with the 90-day feed). Each feed card of type "deep-dive" must
// have a slug here, and the viewer page renders it from this file.
const divesPath = path.join(ROOT, "news", "deep-dives.json");
if (!existsSync(divesPath)) {
  if (diveRefs.length) bad(`news/deep-dives.json absent but ${diveRefs.length} feed card(s) reference a deep dive`);
  else note("news/deep-dives.json absent — no deep dives published yet");
} else {
  try {
    const lib = JSON.parse(readFileSync(divesPath, "utf8"));
    if (typeof lib !== "object" || lib === null || Array.isArray(lib)) throw new Error("root must be an object");
    if (lib.version !== 1) throw new Error("version must be 1");
    if (!Array.isArray(lib.dives)) throw new Error("dives must be an array");
    const slugs = new Set();
    lib.dives.forEach((dv, i) => {
      if (!dv || typeof dv !== "object" || Array.isArray(dv)) throw new Error(`dives[${i}] must be an object`);
      if (typeof dv.slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(dv.slug)) {
        throw new Error(`dives[${i}].slug must be lowercase-kebab`);
      }
      if (slugs.has(dv.slug)) throw new Error(`duplicate slug ${dv.slug}`);
      slugs.add(dv.slug);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dv.date || ""))) throw new Error(`dives[${i}].date must be YYYY-MM-DD`);
      if (typeof dv.title !== "string" || !dv.title.trim()) throw new Error(`dives[${i}].title missing`);
      if (typeof dv.tldr !== "string" || !dv.tldr.trim()) warn(`dives[${i}] ("${dv.slug}") has no tldr`);
      if (typeof dv.summary !== "string" || !dv.summary.trim()) warn(`dives[${i}] ("${dv.slug}") has no summary`);
      if (dv.details !== undefined && !Array.isArray(dv.details)) throw new Error(`dives[${i}].details must be an array of strings`);
      dv.details?.forEach((x, k) => {
        if (typeof x !== "string" || !x.trim()) throw new Error(`dives[${i}].details[${k}] must be a non-empty string`);
      });
      if (dv.links !== undefined && !Array.isArray(dv.links)) throw new Error(`dives[${i}].links must be an array`);
      dv.links?.forEach((l, k) => {
        if (!l || typeof l !== "object") throw new Error(`dives[${i}].links[${k}] must be an object`);
        if (typeof l.url !== "string" || !/^https?:\/\//i.test(l.url)) {
          throw new Error(`dives[${i}].links[${k}].url must be an absolute http(s) URL`);
        }
        if (typeof l.label !== "string" || !l.label.trim()) warn(`dives[${i}].links[${k}] has no label (the raw URL shows instead)`);
      });
    });
    for (const ref of diveRefs) {
      if (!slugs.has(ref.slug)) bad(`${ref.where}: deep-dive slug "${ref.slug}" has no entry in news/deep-dives.json — its card would link to a missing page`);
      const dive = lib.dives.find((x) => x.slug === ref.slug);
      if (dive && dive.date !== ref.date) warn(`deep dive "${ref.slug}" is dated ${dive.date} but its feed card sits under ${ref.date}`);
    }
    good(`deep-dive library OK: ${lib.dives.length} dive(s)`);
  } catch (e) {
    bad("news/deep-dives.json: " + e.message);
  }
}

/* 6. size report -------------------------------------------------------- */
// The Rolling Thunder payload is COMMITTED on purpose (projects/rthunder/play/assets/):
// the site ships its own build so every client can play. GitHub's per-file hard
// limit is 100 MB (files over 50 MB get a push warning but are accepted), so those
// are the thresholds that matter now.
const bytes = files.reduce((a, f) => a + statSync(f).size, 0);
const biggest = files.map((f) => [statSync(f).size, path.relative(ROOT, f)]).sort((a, b) => b[0] - a[0])[0];
console.log(`\n  repo (working tree): ${(bytes / 1024).toFixed(0)} KiB · largest file ${biggest[1]} at ${(biggest[0] / 1024).toFixed(0)} KiB`);
if (biggest[0] > 100 * 1024 * 1024) bad("a file over 100 MB is in the repo — GitHub's per-file hard limit blocks the push");
else if (biggest[0] > 50 * 1024 * 1024) warn(`${biggest[1]} is over 50 MB — GitHub accepts it but will nag on push; expect a slow one`);

console.log("\n  " + "─".repeat(40));
console.log(errors ? `  ${errors} error(s), ${warnings} warning(s)\n`
                   : `  clean · ${warnings} warning(s)\n`);
process.exit(errors ? 1 : 0);
