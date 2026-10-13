/* ==========================================================================
   Sorklin Group — site behaviour
   No dependencies, no build step. Every feature is guarded by the presence of
   the markup it needs, so one file safely serves every page.
   ========================================================================== */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------------- chrome -- */
  var nav = $(".site-nav");
  if (nav) {
    var onScroll = function () { nav.classList.toggle("stuck", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var toggle = $(".nav-toggle");
  if (toggle) {
    var links = $(".nav-links");
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
    });
  }

  /* Mark the current section in the nav (folder-style URLs resolve the same way). */
  (function markCurrent() {
    var here = location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
    $$(".nav-links a:not(.nav-cta)").forEach(function (a) {
      var target = (a.getAttribute("href") || "").replace(/index\.html$/, "").replace(/\/$/, "");
      if (target && here === target) a.setAttribute("aria-current", "page");
    });
  })();

  /* ------------------------------------------------------- scroll reveal -- */
  var revealables = $$(".reveal");
  if (revealables.length && "IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var d = el.getAttribute("data-delay");
        if (d) el.style.transitionDelay = d + "ms";
        el.classList.add("in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("in"); });
  }

  /* -------------------------------------------------- pointer-tracking -- */
  if (!reduced && window.matchMedia("(hover: hover)").matches) {
    document.addEventListener("pointermove", function (e) {
      var card = e.target.closest ? e.target.closest(".card") : null;
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      card.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    }, { passive: true });
  }

  /* ------------------------------------------------ scramble-decode text -- */
  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&/<>=*+";
  function scramble(el) {
    var final = el.getAttribute("data-text") || el.textContent;
    el.setAttribute("data-text", final);
    if (reduced) { el.textContent = final; return; }
    var frame = 0, total = 26;
    var tick = function () {
      var out = "";
      for (var i = 0; i < final.length; i++) {
        var ch = final[i];
        if (ch === " " || ch === "\n") { out += ch; continue; }
        var settleAt = (i / final.length) * (total * 0.72) + 3;
        out += frame > settleAt ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (frame++ < total + final.length * 0.2) {
        setTimeout(tick, 34);
      } else {
        el.textContent = final;
      }
    };
    tick();
  }
  var scramblers = $$("[data-scramble]");
  if (scramblers.length && "IntersectionObserver" in window) {
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        scramble(en.target);
        so.unobserve(en.target);
      });
    }, { threshold: 0.6 });
    scramblers.forEach(function (el) { so.observe(el); });
  }

  /* --------------------------------------------------------- count-up -- */
  $$("[data-count]").forEach(function (el) {
    var run = function () {
      var to = parseFloat(el.getAttribute("data-count"));
      var dec = (el.getAttribute("data-dec") || 0) | 0;
      var prefix = el.getAttribute("data-prefix") || "";
      var suffix = el.getAttribute("data-suffix") || "";
      // A non-numeric data-count is not a count-up target (some pages use the
      // attribute as a plain label) — leave its text alone rather than write NaN.
      if (isNaN(to)) return;
      if (reduced) { el.textContent = prefix + to.toFixed(dec) + suffix; return; }
      var t0 = performance.now(), dur = 1250;
      var step = function (now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + (to * eased).toFixed(dec) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if ("IntersectionObserver" in window) {
      var o = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { run(); o.unobserve(en.target); } });
      }, { threshold: 0.5 });
      o.observe(el);
    } else { run(); }
  });

  /* ---------------------------------------------------- hero terminal -- */
  // The lines are written as ordinary text in the HTML, so the panel still reads
  // correctly with JavaScript switched off; we only animate it if we can.
  var term = $("[data-terminal]");
  if (term) {
    var scriptLines = [];
    $$("[data-line]", term).forEach(function (el) {
      scriptLines.push({
        el: el,
        text: (el.textContent || "").trim(),
        // Lines containing <span> colouring can't be typed one character at a
        // time — assigning textContent would flatten the markup — so they
        // appear whole when their turn comes round.
        html: el.innerHTML,
        rich: el.children.length > 0,
        cls: el.className,
        delay: parseInt(el.getAttribute("data-delay") || "0", 10)
      });
      el.textContent = "";
    });
    if (reduced) {
      scriptLines.forEach(function (l) { l.el.textContent = l.text; });
    } else {
      (function play(i) {
        if (i >= scriptLines.length) {
          var c = document.createElement("span");
          c.className = "caret";
          term.appendChild(c);
          return;
        }
        var line = scriptLines[i];
        var isCmd = line.cls.indexOf("cmd") >= 0;
        if (line.rich || !isCmd) {
          line.el.innerHTML = line.html;
          setTimeout(function () { play(i + 1); }, line.delay || (isCmd ? 380 : 220));
          return;
        }
        var chars = line.text.split("");
        var j = 0;
        var typeChar = function () {
          if (j >= chars.length) {
            setTimeout(function () { play(i + 1); }, 380);
            return;
          }
          line.el.textContent += chars[j++];
          setTimeout(typeChar, 26 + Math.random() * 34);
        };
        setTimeout(typeChar, line.delay || 200);
      })(0);
    }
  }

  /* ----------------------------------------------------------- ticker -- */
  var track = $(".ticker-track");
  if (track && !reduced) {
    // duplicate the strip so the -50% translate loops seamlessly
    track.innerHTML += track.innerHTML;
  }

  /* ------------------------------------------------------ daily brief -- */
  // Homepage strip: upgrade the static fallback link with the latest
  // headlines once /news/news.json loads. Silent on any failure — the
  // fallback link is the whole feature when the feed is missing. Feed
  // content goes in via textContent/attributes only.
  // Linking: "The Daily Brief" (static) goes to the page; each headline
  // goes to that story's OWN entry on /news/ — anchor #story-<date>-<n>,
  // the id the news renderer assigns from the same feed file (n = 1-based
  // position in that day's items, skipping malformed ones — which is why
  // the index is captured before filtering); "Today's briefing" jumps to
  // the top of the newest day's entry (#day-<date>), today's date if the
  // feed already carries it. These are internal navigations — the
  // new-tab house rule applies to publisher links on the news page only.
  (function briefStrip() {
    var strip = $("[data-brief-strip]");
    var holder = $("[data-brief-items]");
    if (!holder || typeof window.fetch !== "function") return;
    var more = strip ? strip.querySelector(".brief-strip-more") : null;
    fetch("/news/news.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var days = data && Array.isArray(data.days) ? data.days : [];
        var day = null;
        for (var i = 0; i < days.length; i++) {
          var d = days[i];
          if (d && Array.isArray(d.items) && (!day || String(d.date) > String(day.date))) day = d;
        }
        var picked = [];
        if (day) {
          for (var j = 0; j < day.items.length && picked.length < 3; j++) {
            var it = day.items[j];
            // Publisher stories carry a url; deep-dive cards carry a slug —
            // both render in the feed with #story- anchors.
            var isDive = it && it.type === "deep-dive" && /^[a-z0-9][a-z0-9-]*$/.test(String(it.slug || ""));
            var isStory = it && /^https?:\/\//i.test(String(it.url || ""));
            if (isDive || isStory) picked.push({ it: it, n: j + 1 });
          }
        }
        if (!picked.length) return; // keep the static fallback links
        if (more) {
          var now = new Date();
          var pad = function (n) { return (n < 10 ? "0" : "") + n; };
          var iso = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
          var hasToday = days.some(function (x) { return x && x.date === iso; });
          more.setAttribute("href", "/news/#day-" + (hasToday ? iso : day.date));
        }
        holder.textContent = "";
        picked.forEach(function (e) {
          var a = document.createElement("a");
          a.className = "brief-strip-item";
          a.href = "/news/#story-" + day.date + "-" + e.n; // the story's entry on the page
          a.title = String(e.it.title || "");
          if (e.it.source) {
            var src = document.createElement("span");
            src.className = "src";
            src.textContent = String(e.it.source) + " ·";
            a.appendChild(src);
          }
          a.appendChild(document.createTextNode(" " + String(e.it.title || "")));
          holder.appendChild(a);
        });
      })
      .catch(function () { /* feed missing or bad: static fallback stays */ });
  })();

  /* -------------------------------------------------- corporate mode -- */
  var corpBtn = $("[data-corporate-toggle]");
  if (corpBtn) {
    var KEY = "sorklin:corporate";
    var apply = function (on) {
      document.body.classList.toggle("corporate", on);
      corpBtn.textContent = on ? "Add some personality back" : "Make it more corporate";
      try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    };
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    apply(saved === "1");
    corpBtn.addEventListener("click", function () { apply(!document.body.classList.contains("corporate")); });
  }

  /* ------------------------------------------------------ theme cycle -- */
  // Four looks, one stylesheet. The footer button cycles them; an inline
  // snippet in every page head restores the saved theme before first paint
  // (this module then syncs the label). Midnight = no data-theme attribute.
  var THEMES = ["midnight", "daylight", "arcade", "press"];
  var THEME_LABELS = { midnight: "Midnight", daylight: "Daylight", arcade: "Arcade", press: "Press" };
  var THEME_META = { midnight: "#05070b", daylight: "#f7f8fa", arcade: "#fff9ef", press: "#fdf1e3" };
  var themeBtn = $("[data-theme-cycle]");
  var htmlEl = document.documentElement;
  if (themeBtn && htmlEl) {
    var applyTheme = function (t) {
      if (t === "midnight") htmlEl.removeAttribute("data-theme");
      else htmlEl.setAttribute("data-theme", t);
      var meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", THEME_META[t] || THEME_META.midnight);
      themeBtn.textContent = "Theme: " + THEME_LABELS[t];
      try { localStorage.setItem("sorklin:theme", t); } catch (e) {}
    };
    var currentTheme = htmlEl.getAttribute("data-theme") || "midnight";
    if (THEMES.indexOf(currentTheme) === -1) currentTheme = "midnight";
    applyTheme(currentTheme);
    themeBtn.addEventListener("click", function () {
      var now = htmlEl.getAttribute("data-theme") || "midnight";
      if (THEMES.indexOf(now) === -1) now = "midnight";
      applyTheme(THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]);
    });
  }

  /* --------------------------------------------------- ambient field -- */
  var cv = $("#field");
  if (cv && !reduced) {
    var ctx = cv.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, pts = [];
    var resize = function () {
      var r = cv.getBoundingClientRect();
      w = cv.width = Math.max(1, Math.floor(r.width * dpr));
      h = cv.height = Math.max(1, Math.floor(r.height * dpr));
      var n = Math.round((r.width * r.height) / 13000);
      pts = [];
      for (var i = 0; i < Math.min(n, 190); i++) {
        pts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: (Math.random() * 1.1 + 0.35) * dpr,
          s: Math.random() * 0.6 + 0.15,
          p: Math.random() * Math.PI * 2
        });
      }
    };
    var t = 0;
    var frame = function () {
      t += 0.006;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        // a slow travelling wave decides how lit each dot is
        var wave = Math.sin(p.x * 0.0032 + t) * Math.cos(p.y * 0.0026 - t * 0.7);
        var lit = 0.1 + 0.42 * Math.max(0, wave);
        p.y -= p.s * dpr * 0.28;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fillStyle = "rgba(120, 200, 235," + lit.toFixed(3) + ")";
        ctx.fill();
      }
      requestAnimationFrame(frame);
    };
    var raf;
    var start = function () { cancelAnimationFrame(raf); resize(); raf = requestAnimationFrame(frame); };
    window.addEventListener("resize", start);
    start();
  }
})();
