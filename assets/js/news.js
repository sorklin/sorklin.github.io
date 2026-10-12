/* ==========================================================================
   Sorklin Group — The Daily Brief renderer (news/index.html)
   --------------------------------------------------------------------------
   Reads ./news.json — the plain file the daily writer process maintains —
   and renders date-grouped story summaries. No dependencies, no build step.

   Two house rules live here on purpose:

   1. Everything the feed supplies goes into the DOM via textContent and
      attribute assignment, never innerHTML. The feed is written by another
      process; a malformed or hostile file must not be able to inject markup.
   2. Publisher links ALWAYS open in a new tab/window: target="_blank" with
      rel="noopener noreferrer", set in articleLink() — in one place, so the
      rule cannot drift per-story.

   The whole file is guarded: if anything fails, the page falls back to a
   readable error state (or the static shell + <noscript> if JS never runs).
   ========================================================================== */
(function () {
  "use strict";

  var list = document.getElementById("brief-list");
  if (!list) return;

  var PAGE = 7; // day-groups revealed per "load older" click
  var state = {
    days: [],        // normalised feed, newest first
    updated: null,   // ISO date string of the newest day
    filter: "all",   // all | security | ai
    shown: PAGE,     // how many day-groups are currently rendered
    counts: { all: 0, security: 0, ai: 0 }
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------------ helpers -- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Parse "YYYY-MM-DD" as a LOCAL date. new Date("2026-10-11") is parsed as
  // UTC midnight and slides back a day in negative offsets — split instead.
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  function dayDiff(from, to) {
    var utc = function (d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
    return Math.round((utc(to) - utc(from)) / 86400000);
  }

  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch (e) { /* ancient engine: raw ISO dates still render */ }

  function dayLabel(s) {
    var d = parseDay(s);
    return d && fmt ? fmt.format(d) : String(s || "");
  }

  function relativeTag(s) {
    var d = parseDay(s);
    if (!d) return "";
    var diff = dayDiff(d, new Date());
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return "";
  }

  /* ------------------------------------------------------ feed handling -- */

  // The feed is machine-written; never trust its shape. Returns a normalised
  // { updated, days } (newest first) or throws with a readable reason.
  // Unknown categories survive as "news" rather than being dropped — a new
  // tag in the writer should degrade, not delete stories.
  function normalise(raw) {
    if (!raw || typeof raw !== "object") throw new Error("feed is not an object");
    if (!Array.isArray(raw.days)) throw new Error("feed has no days array");
    var seen = {};
    var out = [];
    for (var i = 0; i < raw.days.length; i++) {
      var day = raw.days[i] || {};
      var date = String(day.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("day " + i + " has a bad date " + date);
      if (seen[date]) throw new Error("duplicate day " + date);
      seen[date] = true;
      var items = Array.isArray(day.items) ? day.items : [];
      var clean = [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j] || {};
        var url = String(it.url || "");
        if (!/^https?:\/\//i.test(url)) continue; // never render a non-web link
        clean.push({
          title: String(it.title || "").trim() || "(untitled)",
          url: url,
          source: String(it.source || "").trim(),
          tldr: String(it.tldr || "").trim(),
          summary: String(it.summary || "").trim(),
          details: (Array.isArray(it.details) ? it.details : [])
            .map(function (d) { return String(d == null ? "" : d).trim(); })
            .filter(Boolean),
          links: (Array.isArray(it.links) ? it.links : [])
            .filter(function (l) { return l && /^https?:\/\//i.test(String(l.url || "")); })
            .map(function (l) { return { label: String(l.label || "").trim(), url: String(l.url) }; }),
          category: it.category === "ai" ? "ai" : it.category === "security" ? "security" : "news"
        });
      }
      out.push({ date: date, items: clean });
    }
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return { updated: raw.updated || (out[0] && out[0].date) || null, days: out };
  }

  function matches(item) {
    return state.filter === "all" || item.category === state.filter;
  }

  function catLabel(c) {
    return c === "ai" ? "AI Security" : c === "security" ? "Security" : "News";
  }

  /* The house rule: publisher links ALWAYS open in a new tab/window. */
  function articleLink(item) {
    var a = el("a", "news-headline-link", item.title);
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    var ext = el("span", "ext", "↗");
    ext.setAttribute("aria-hidden", "true");
    a.appendChild(ext);
    return a;
  }

  /* A labelled source link — same house rule as above. */
  function sourceLink(link) {
    var a = el("a", null, link.label || link.url);
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    var ext = el("span", "ext", "↗");
    ext.setAttribute("aria-hidden", "true");
    a.appendChild(ext);
    return a;
  }

  var BADGE = { security: "badge info", ai: "badge ai", news: "badge soon" };
  var TINT = { security: "", ai: "tint-ai", news: "tint-news" };

  function articleNode(item, date, idx) {
    var art = el("article", "news-item " + (TINT[item.category] || ""));
    // Anchor target for deep links (homepage strip): /news/#story-<date>-<n>
    // where <n> is the story's 1-based position in the feed's items array —
    // computed from the file, so the strip and this page always agree.
    art.id = "story-" + date + "-" + (idx + 1);

    var meta = el("div", "news-meta");
    meta.appendChild(el("span", BADGE[item.category] || BADGE.news, catLabel(item.category)));
    if (item.source) meta.appendChild(el("span", "news-src", item.source));
    art.appendChild(meta);

    var h = el("h3", "news-headline");
    h.appendChild(articleLink(item));
    art.appendChild(h);

    // Always visible: the one-line TL;DR.
    if (item.tldr) {
      var t = el("p", "news-tldr");
      t.appendChild(el("span", "lbl", "TL;DR"));
      t.appendChild(el("span", null, item.tldr));
      art.appendChild(t);
    }

    // Collapsed by default: summary, key facts and sources in a native
    // <details> accordion — keyboard and screen-reader friendly, no JS needed.
    var hasBody = item.summary || item.details.length || item.links.length;
    if (hasBody) {
      var parts = [];
      if (item.summary) parts.push("Summary");
      if (item.details.length) parts.push("Key facts");
      if (item.links.length) parts.push("Sources");

      var body = el("div", "news-details-body");
      if (item.summary) body.appendChild(el("p", "news-summary", item.summary));
      if (item.details.length) {
        body.appendChild(el("div", "news-sub", "Key facts"));
        var facts = el("ul", "dashes");
        for (var d = 0; d < item.details.length; d++) facts.appendChild(el("li", null, item.details[d]));
        body.appendChild(facts);
      }
      if (item.links.length) {
        body.appendChild(el("div", "news-sub", "Sources"));
        var sources = el("ul", "news-links");
        for (var s = 0; s < item.links.length; s++) {
          var li = el("li");
          li.appendChild(sourceLink(item.links[s]));
          sources.appendChild(li);
        }
        body.appendChild(sources);
      }

      var det = el("details", "news-details");
      var sum = el("summary");
      sum.appendChild(el("span", "sum-txt", parts.join(" · ")));
      var chev = el("span", "chev", "▶");
      chev.setAttribute("aria-hidden", "true");
      sum.appendChild(chev);
      det.appendChild(sum);
      det.appendChild(body);
      art.appendChild(det);
    }

    return art;
  }

  function dayNode(day, count) {
    var sec = el("section", "news-day");
    // Anchor target for deep links (homepage strip): /news/#day-<date>
    sec.id = "day-" + day.date;
    var head = el("div", "news-date");
    head.appendChild(el("h2", "news-date-d", dayLabel(day.date)));
    var tag = relativeTag(day.date);
    if (tag) head.appendChild(el("span", "news-date-tag", tag));
    head.appendChild(el("span", "news-date-count", count + (count === 1 ? " story" : " stories")));
    sec.appendChild(head);
    var wrap = el("div", "news-items");
    for (var i = 0; i < day.items.length; i++) {
      var it = day.items[i];
      // idx i is the story's position in the feed FILE (not the filtered
      // sequence), so anchors stay in sync with the homepage strip even when
      // the renderer drops malformed items.
      if (matches(it)) wrap.appendChild(articleNode(it, day.date, i));
    }
    sec.appendChild(wrap);
    return sec;
  }

  function stateNode(title, body, retry) {
    var box = el("div", "news-state");
    box.appendChild(el("h3", null, title));
    box.appendChild(el("p", null, body));
    if (retry) {
      var b = el("button", "btn btn-ghost", "Try again");
      b.type = "button";
      b.addEventListener("click", function () { load(); });
      box.appendChild(b);
    }
    return box;
  }

  /* ----------------------------------------------------------- rendering -- */

  function render() {
    list.textContent = "";

    var visibleDays = [];
    for (var i = 0; i < state.days.length; i++) {
      var n = 0;
      for (var j = 0; j < state.days[i].items.length; j++) if (matches(state.days[i].items[j])) n++;
      if (n > 0) visibleDays.push({ day: state.days[i], count: n });
    }

    if (!visibleDays.length) {
      list.appendChild(stateNode(
        state.filter === "all" ? "No briefings yet" : "Nothing filed under " + catLabel(state.filter) + " in the archive",
        state.filter === "all"
          ? "The feed is live but empty. The first briefing lands with the next daily run — the page fills itself when it does."
          : "Switch back to All — the other tag has stories in this window."
      ));
      return;
    }

    var page = visibleDays.slice(0, state.shown);
    for (var k = 0; k < page.length; k++) list.appendChild(dayNode(page[k].day, page[k].count));

    var more = $("#news-more");
    if (more) more.hidden = visibleDays.length <= state.shown;
  }

  function renderCounts() {
    var tabs = $$(".news-tab");
    for (var i = 0; i < tabs.length; i++) {
      var f = tabs[i].getAttribute("data-filter");
      var n = tabs[i].querySelector(".n");
      if (n) n.textContent = String(state.counts[f] || 0);
    }
    var stamp = $("#news-updated");
    if (stamp) {
      stamp.textContent = state.updated
        ? "Updated " + (dayLabel(state.updated) || state.updated)
        : "";
    }
  }

  function recomputeCounts() {
    var c = { all: 0, security: 0, ai: 0 };
    for (var i = 0; i < state.days.length; i++) {
      for (var j = 0; j < state.days[i].items.length; j++) {
        var cat = state.days[i].items[j].category;
        c.all++;
        if (c[cat] != null) c[cat]++;
      }
    }
    state.counts = c;
  }

  /* -------------------------------------------------------------- wiring -- */

  var tabs = $$(".news-tab");
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", function () {
      var btn = this;
      state.filter = btn.getAttribute("data-filter") || "all";
      state.shown = PAGE;
      for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-pressed", tabs[i] === btn ? "true" : "false");
      render();
    });
  }

  var moreBtn = $("#news-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      state.shown += PAGE;
      render();
    });
  }

  /* Deep links from the homepage strip (#story-… / #day-…) land on a story;
     pop its accordion open so the reader arrives at the whole entry, not a
     collapsed card. Runs after each render and on in-page hash changes. */
  function openTargetDetails() {
    if (!location.hash) return;
    var t = document.getElementById(location.hash.slice(1));
    if (!t) return;
    var d = t.tagName === "DETAILS" ? t : t.querySelector("details");
    if (d) d.open = true;
  }
  window.addEventListener("hashchange", openTargetDetails);

  /* --------------------------------------------------------------- load -- */

  function load() {
    list.textContent = "";
    list.appendChild(el("p", "dim mono news-loading", "Loading the briefing…"));
    // no-store: the feed changes daily and Pages caches aggressively; the file
    // is small, correctness beats the round trip.
    fetch("./news.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        var feed = normalise(raw);
        state.days = feed.days;
        state.updated = feed.updated;
        state.shown = PAGE;
        recomputeCounts();
        renderCounts();
        var controls = $("#news-controls");
        if (controls) controls.hidden = false;
        render();
        openTargetDetails();
      })
      .catch(function (err) {
        list.textContent = "";
        list.appendChild(stateNode(
          "Couldn't load the briefing",
          "The feed file didn't load or didn't parse (" + (err && err.message ? err.message : "unknown error") + "). " +
          "If this is the first run, the writer process hasn't published /news/news.json yet.",
          true
        ));
      });
  }

  load();
})();
