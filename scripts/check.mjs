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
  "about/index.html",
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
