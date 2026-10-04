#!/usr/bin/env node
// serve.mjs — zero-dependency static server for local preview.
//
//   node serve.mjs                 → http://127.0.0.1:8080/  (+ LAN URLs)
//   node serve.mjs 9000            → different port
//   node serve.mjs --build <dir>   → also serves <dir> at  /rthunder-build/   (CORS: *)
//   node serve.mjs --assets <dir>  → also serves <dir> at  /projects/rthunder/play/assets/
//
// Binds EVERY interface, so a phone or another PC on the same network can open the
// site (and play Rolling Thunder) at http://<this-machine's-LAN-ip>:<port>/ — the
// exact URLs are printed at startup. Node needs no admin rights for this; if a
// device still cannot connect, it is the host firewall, not this server.
//
// --build / --assets exist so a different Rolling Thunder core can be served
// during development without copying it over the committed one: the committed
// build lives in projects/rthunder/play/assets/, and either mount overrides it.
//
// Correct MIME types matter here: a .wasm served as application/octet-stream
// makes WebAssembly.instantiateStreaming fail in confusing ways.

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const numArg = argv.find((a) => /^\d+$/.test(a));
const PORT = Number(numArg || process.env.PORT || 8080);
const optDir = (name) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : null;
};
const MOUNTS = [
  { mount: "/rthunder-build/", dir: optDir("build") },
  { mount: "/projects/rthunder/play/assets/", dir: optDir("assets") },
].filter((m) => m.dir);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bdf": "application/octet-stream",
  ".zip": "application/zip",
  ".mcu": "application/octet-stream",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".map": "application/json",
  ".pdf": "application/pdf",
};

function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  for (const m of MOUNTS) {
    if (clean.startsWith(m.mount)) {
      return { base: m.dir, rel: clean.slice(m.mount.length), mounted: true };
    }
  }
  return { base: ROOT, rel: clean, mounted: false };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ "Content-Length": Buffer.byteLength(body) }, headers));
  res.end(body);
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method Not Allowed\n", { "Content-Type": "text/plain" });
  }

  const { base, rel, mounted } = resolveTarget(req.url);
  // URLs always start with "/" — strip it, then make sure nothing escaped the base.
  const cleanRel = rel.replace(/^\/+/, "");
  if (cleanRel.includes("\0") || cleanRel.includes("..")) {
    return send(res, 400, "Bad request\n", { "Content-Type": "text/plain" });
  }

  const root = path.resolve(base);
  let file = path.normalize(path.join(root, cleanRel));
  if (file !== root && !file.startsWith(root + path.sep)) {
    return send(res, 403, "Forbidden\n", { "Content-Type": "text/plain" });
  }

  // directory → index.html, and a bare /foo/ folder that has a foo.html twin
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file) && !path.extname(file) && existsSync(file + ".html")) file += ".html";

  if (!existsSync(file) || !statSync(file).isFile()) {
    const notFound = path.join(ROOT, "404.html");
    if (existsSync(notFound)) {
      res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      return (req.method === "HEAD" ? res : createReadStream(notFound)).pipe(res);
    }
    return send(res, 404, "Not found\n", { "Content-Type": "text/plain" });
  }

  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const html = type.startsWith("text/html");
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": statSync(file).size,
    // HTML never cached so an edit shows on reload; everything else briefly,
    // matching GitHub Pages behaviour closely enough to be useful.
    "Cache-Control": html ? "no-store" : "public, max-age=300",
    ...(mounted ? { "Access-Control-Allow-Origin": "*" } : {}),
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use. Try:  node serve.mjs ${PORT + 1}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const lan = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) lan.push(a.address);
    }
  }
  console.log(`\n  Sorklin Group — local preview\n  ${"─".repeat(46)}`);
  console.log(`  this machine    http://127.0.0.1:${PORT}/`);
  for (const ip of lan) console.log(`  other devices   http://${ip}:${PORT}/   (same network)`);
  if (lan.length) console.log(`                  (refused? it is the host firewall, not this server)`);
  console.log(`  serving ${ROOT}`);
  for (const m of MOUNTS) console.log(`  mounted ${m.mount} → ${m.dir}`);
  if (!MOUNTS.some((m) => m.mount === "/projects/rthunder/play/assets/")) {
    console.log("  (Rolling Thunder loads from the committed copy in projects/rthunder/play/assets/)");
  }
  console.log("  Ctrl-C to stop\n");
});
