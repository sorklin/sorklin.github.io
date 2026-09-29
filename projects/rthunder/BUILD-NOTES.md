> **Vendored copy**, from the build workspace. The ~54 MB of build payload
> (`wasm/rthunder.wasm`, glue, font, ROM) is not on this site — see the
> `README.md` at the repository root for how the play page finds them.
> A longer, messier build log (`NOTES.md`, rootless MAME→WebAssembly in a
> container) lives in the source project and is worth a read if you like that
> sort of thing.

# Rolling Thunder (Namco, 1986) — playable in the browser

The `rthunder/` ROM set in this folder is a complete, correct **MAME** set for *Rolling Thunder
(rev 3)* on Namco System 86. This directory now contains a browser build you can actually play:

```
node app/server.js 8123        # then open http://localhost:8123/
```

**Running inside the Docker container?** Only the harness port is forwarded to your machine, so
`http://127.0.0.1:8123/` from your browser will not connect. Read **`START-HERE.txt`** — the short
version: this folder is also `D:\work\rthunder` on your host, so Firefox can open
`file:///D:/work/rthunder/app/index.html` directly, or you run `node app\server.js 8123` on the host, or
you forward container port 8123 through nginx the same way 3090 reaches host port 3080. The server
listens on `0.0.0.0` for exactly that reason.

(Any static file server works — `app/` is self-contained and the page runs offline. The extra
`?verify=1` mode mirrors the emulator log and posts canvas grabs to `verify/`, and `POST /upload`
/ `POST /log` are only used by that mode.)

## What runs the game

| Engine | URL | What it is |
|---|---|---|
| **MAME / WASM** (default) | `/` | MAME 0.277, driver `src/mame/namco/namcos86.cpp`, compiled to WebAssembly here with Emscripten 6.0.10. Exact ROM match, real save states, Tab menu, DIP switches. |
| MAME 2003-Plus | `/?engine=emulatorjs` | EmulatorJS + the `mame2003_plus` libretro core (MAME 0.37b15) as a fallback; the ROM zip is renamed to that era's file names (`roms/legacy/rthunder.zip`). |

If the WASM build is missing or fails to start, the page logs why and falls back automatically.

## Controls

| Action | Keys |
|---|---|
| Move / aim | arrow keys, or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> |
| Shot (button 1) | <kbd>Ctrl</kbd>, <kbd>J</kbd> or <kbd>Z</kbd> |
| Button 2 | <kbd>Alt</kbd>, <kbd>K</kbd> or <kbd>X</kbd> |
| Insert coin | <kbd>5</kbd> |
| Start | <kbd>1</kbd> |
| Player 2 | <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>U</kbd> + <kbd>F</kbd>/<kbd>G</kbd> |
| MAME menu (DIPs, graphics) | <kbd>Tab</kbd> |

Rolling Thunder uses a **4-way** stick: walk with ←/→, aim up/down with ↑/↓. There are no diagonals.
The on-screen pad (touch or mouse) works too, and MAME also picks up real gamepads.

DIP switches worth knowing (in the Tab menu → *Cabinet DIP Switches*): difficulty, 3 or 5 lives,
120 s or 150 s timer, plus the cheats **Invulnerability**, **Freeze** and **Level Select**.

## Layout

```
app/index.html                 the page (both engines, controls, diagnostics)
app/server.js                  static server + the sinks used by ?verify=1
app/wasm/                      rthunder.js, rthunder.wasm, uismall.bdf  (built here)
app/roms/rthunder.zip          28 files, modern MAME names
app/roms/legacy/rthunder.zip   same bytes, 0.37b15 names (for mame2003*)
app/emulatorjs/                mirrored EmulatorJS runtime + cores (offline)
tools/                         toolchain bootstrap, MAME build, headless verifier
verify/, verify-wasm/          captures from headless runs
NOTES.md                       the full technical log
```

## Rebuilding the emulator

Everything is rootless — `tools/` contains make, python, `xz`, emsdk and a Debian-package fetcher,
all installed into this workspace.

```
bash tools/bootstrap.sh        # python, make, emsdk, MAME source, SDL ports
bash tools/build_genie.sh      # GENie as a node program (NODERAWFS + outputof cache)
bash tools/build_mame2.sh      # MAME -> app/wasm/rthunder.js + .wasm
```

`NOTES.md` documents every workaround (why `gcc` is a wrapper, why `sdl2-config` is a stub, why
`os.outputof` is cached, why exception catching must be module-wide, …).

## Honest caveats

* **What I could prove here vs. what I could not.** The container this was built in has a 512-task
  cgroup limit, and headless Chromium + SwiftShader keeps losing renderers against it (see
  `NOTES.md` §13). Verified headless: the wasm core loads, the ROM set passes every CRC, the
  Namco System 86 machine starts (YM2151, CUS30, CUS42/43 tilemaps, HD63701X), WebAudio initialises,
  and `JSMAME.get_machine()` is live with the page's rAF loop at ~60 Hz. What I could *not* capture
  here is the pixels: screenshot APIs don't work in the mode that stays stable, and `readPixels` on
  SDL's canvas reads black. So the page watches itself — if the wasm core aborts, exits, or never
  creates a machine, it **switches to the EmulatorJS core by itself**, and if the canvas stays black
  it tells you and links the fallback core. Please report which engine you end up on.
* `hd637a01x0p.e3` — the internal ROM of the *second* HD63701 sound MCU — has never been dumped
  (`NO_DUMP` in the driver), so a few PCM effects can be silent. Nothing on our side can fix that.
* The `mame2003_plus` fallback expects a different `rt1-mcu.bin` dump (CRC `6ef08fb3`); our set has
  `cus60-60a1.mcu` (`076ea82a`). It boots, but that core is a 1998-era MAME — use the WASM engine
  for an accurate experience.
* Sound only starts after the first click (browser autoplay policy) — that is what the
  "click to insert coin" overlay is for.

## Debug switches

`?engine=wasm|emulatorjs` · `?verify=1` (log mirror + canvas grabs) · `?mameargs=-sound dummy`
(extra MAME options) · `?sdlsoft=1` (SDL CPU renderer) · `?luaprobe=1` (Lua heartbeat inside MAME).

