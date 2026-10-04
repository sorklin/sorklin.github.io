#!/usr/bin/env node
// package-rthunder.mjs — stage the Rolling Thunder (wasm/MAME) build.
//
//   node scripts/package-rthunder.mjs [--src <dir>]                → dist/rthunder-build/
//   node scripts/package-rthunder.mjs [--src <dir>] --install-local → projects/rthunder/play/assets/
//
// What it produces
//   * the five build files the play page fetches at runtime, in place
//     (wasm/, roms/ kept as sub-folders);
//   * manifest.json — path, size and CRC32 of each file. The play page reads
//     it and refuses to boot a file whose checksum doesn't match (silently
//     corrupted or truncated downloads are the classic "why is it black").
//
// Since 2026-10 the staged payload is COMMITTED under projects/rthunder/play/assets/,
// so the site is self-contained and the game works for every client (GitHub Pages,
// LAN preview, any static server). `--install-local` is the normal path;
// dist/rthunder-build/ remains for publishing the build on a separate origin:
//   dist/rthunder-build/  →  any host that sends Access-Control-Allow-Origin: *,
//                            then set RT_REMOTE_BASE in play/index.html.
//   ⚠ The payload contains an arcade ROM copyrighted by its owner. It ships here
//     so the project runs; treat redistribution as your own decision, not mine.
//
// Zero dependencies, ESM, Windows-safe: node:path / node:fs only, nothing is
// shelled out, and D:\work\rthunder\app style paths work natively.

import { promises as fsp, createReadStream, existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), "..");
const DEFAULT_SRC = "/work/rthunder/app";

// Exactly what the game page needs, relative to the source app folder.
const FILES = [
  path.join("wasm", "rthunder.js"),
  path.join("wasm", "rthunder.wasm"),
  path.join("wasm", "uismall.bdf"),
  path.join("roms", "rthunder.zip"),
  path.join("roms", "legacy", "rthunder.zip"),  // 0.37b15 names — fetched by the EmulatorJS fallback
  "boot-probe.txt",
];

// Whole trees copied verbatim (every file inside is hashed into the manifest).
// emulatorjs/ is the ?engine=emulatorjs fallback runtime; without it that engine
// cannot start from a staged build.
const DIRS = ["emulatorjs"];

// Junk that must never travel with a staged tree.
const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".git"]);

const args = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const INSTALL_LOCAL = args.includes("--install-local");
const SRC = path.resolve(getOpt("src", DEFAULT_SRC));
const OUT = INSTALL_LOCAL
  ? path.join(REPO_ROOT, "projects", "rthunder", "play", "assets")
  : path.join(REPO_ROOT, "dist", "rthunder-build");

// CRC32 via zlib — same polynomial the play page uses.
function crc32(file) {
  return new Promise((resolve, reject) => {
    let crc = 0 ^ -1;
    const rs = createReadStream(file);
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    rs.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i++) crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    });
    rs.on("end", () => resolve(((crc ^ -1) >>> 0)));
    rs.on("error", reject);
  });
}

const human = (n) =>
  n >= 1 << 20 ? (n / (1 << 20)).toFixed(2) + " MiB"
    : n >= 1 << 10 ? (n / (1 << 10)).toFixed(1) + " KiB"
      : n + " B";

async function listFiles(dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

async function main() {
  console.log("\n  Rolling Thunder build packer");
  console.log("  ─────────────────────────────────────────────");
  console.log(`  source   ${SRC}`);
  console.log(`  output   ${OUT}${INSTALL_LOCAL ? "   (local preview)" : ""}\n`);

  if (!existsSync(SRC)) {
    console.error(`  ✗ source folder not found: ${SRC}`);
    console.error(`    On Windows, pass the real path, e.g.  --src D:\\work\\rthunder\\app\n`);
    process.exit(1);
  }

  await fsp.mkdir(OUT, { recursive: true });

  const manifest = { version: 1, generated: new Date().toISOString(), files: [] };
  let total = 0, copied = 0, missing = 0;

  for (const rel of FILES) {
    const from = path.join(SRC, rel);
    const to = path.join(OUT, rel);
    const label = rel.split(path.sep).join("/");
    if (!existsSync(from)) {
      console.warn(`  ! SKIP   ${label.padEnd(24)} not found in source`);
      missing++;
      continue;
    }
    const size = statSync(from).size;
    const crc = await crc32(from);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
    total += size; copied++;
    manifest.files.push({ path: label, size, crc32: "0x" + crc.toString(16).padStart(8, "0") });
    console.log(`  ✓ ${label.padEnd(24)} ${human(size).padStart(10)}   crc32 0x${crc.toString(16).padStart(8, "0")}`);
  }

// Whole trees (the EmulatorJS fallback runtime): copy every file, hash each one.
// Guard: a mirrored download can leave a 404 HTML page where an asset belongs
// (the source build's cores/*-wasm.js are exactly that — and EmulatorJS 4 loads
// the whole core from the -wasm.data bundle anyway, so those .js files are
// 3.x-era leftovers no 4.x runtime ever fetches). Never stage a stub.
for (const dirName of DIRS) {
    const srcDir = path.join(SRC, dirName);
    if (!existsSync(srcDir)) {
      console.warn(`  ! SKIP   ${dirName}/ tree not found in source (the fallback engine will not run)`);
      missing++;
      continue;
    }
    for (const from of await listFiles(srcDir)) {
      const rel = path.relative(srcDir, from);
      const to = path.join(OUT, dirName, rel);
      const head = Buffer.alloc(512);
      const fh = await fsp.open(from, "r");
      const { bytesRead } = await fh.read(head, 0, 512, 0);
      await fh.close();
      if (/^\s*<(!doctype|html)/i.test(head.toString("latin1", 0, bytesRead))) {
        console.warn(`  ! SKIP   ${[dirName, ...rel.split(path.sep)].join("/")} — HTML error page in the source, not a real asset (EmulatorJS 4 loads cores from the -wasm.data bundle; this .js is a 3.x-era leftover)`);
        continue;
      }
      const size = statSync(from).size;
      const crc = await crc32(from);
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(from, to);
      total += size; copied++;
      const label = [dirName, ...rel.split(path.sep)].join("/");
      manifest.files.push({ path: label, size, crc32: "0x" + crc.toString(16).padStart(8, "0") });
      console.log(`  ✓ ${label.padEnd(24)} ${human(size).padStart(10)}   crc32 0x${crc.toString(16).padStart(8, "0")}`);
    }
  }

  manifest.totalBytes = total;
  await fsp.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  ✓ ${"manifest.json".padEnd(24)} ${human(statSync(path.join(OUT, "manifest.json")).size).padStart(10)}`);

  console.log(`\n  ${copied} file(s) staged, ${human(total)} total.`);
  if (missing) {
    console.warn(`  ${missing} file(s) missing — the build will not run until they exist.\n`);
    process.exit(1);
  }

  console.log("\n  Next");
  if (INSTALL_LOCAL) {
    console.log("  ─ Serve the site and the game will find these files and load from them:");
    console.log("      node serve.mjs        →  http://127.0.0.1:8080/projects/rthunder/play/\n");
    console.log("  (This folder is COMMITTED to the repo — that is what makes the site");
    console.log("   self-contained for GitHub Pages and for any other client. Re-run this");
    console.log("   script whenever you rebuild the core, then git add + push.)\n");
  } else {
    console.log("  ─ Publish the contents of dist/rthunder-build/ somewhere that sends CORS:*:");
    console.log("      any bucket / web server where you control the response headers");
    console.log("    then set RT_REMOTE_BASE at the top of projects/rthunder/play/index.html.\n");
    console.log("  ⚠  That folder contains an arcade ROM copyrighted by its owner. You have");
    console.log("     decided shipping it is fine — just know what the folder is.\n");
    console.log("  ─ Or skip publishing and just preview it here:");
    console.log("      node scripts/package-rthunder.mjs --install-local");
    console.log("      node serve.mjs   →  http://127.0.0.1:8080/projects/rthunder/play/\n");
  }
}

main().catch((err) => {
  console.error("\n  ✗ " + (err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});

