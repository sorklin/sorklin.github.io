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

  var BUDGET = 15; // stories shown before "Load older briefings" — the knob
                  // for "how much stays on the main page"
  var state = {
    days: [],        // normalised feed, newest first
    updated: null,   // ISO date string of the newest day
    filter: "all",   // all | security | ai | dive (topic)
    industry: "all", // all | unspecified | <NAICS sector name> (a second dimension)
    jumpDay: null,   // ISO date of the currently anchored day (jump controls)
    query: "",       // active search terms, lowercased; "" = search off
    queryTerms: [],  // the query split on whitespace (all must appear)
    rawQuery: "",    // the query as typed, for the "matches for" line
    dives: null,     // the deep-dive library, fetched lazily on first search
    divesState: "",  // "" | "loading" | "loaded" | "failed"
    shown: BUDGET,   // how many matching stories are currently rendered
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

  // Industry = top-level NAICS sectors ({ code, name } pairs, the pill shows
  // the name). The writer may omit the field entirely — meaning "none apply",
  // which the page answers with an Unspecified pill. A literal "Unspecified"
  // written by the writer counts as none, and duplicates collapse.
  function parseIndustries(v) {
    if (!Array.isArray(v)) return [];
    var out = [], seen = {};
    for (var i = 0; i < v.length; i++) {
      var e = v[i], name = "", code = "";
      if (typeof e === "string") name = e; // tolerate a bare sector name
      else if (e && typeof e === "object") { name = String(e.name || ""); code = String(e.code || ""); }
      name = name.trim();
      code = code.trim();
      if (!name || name.toLowerCase() === "unspecified") continue;
      var key = name.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ code: code, name: name });
    }
    return out;
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
        var type = it.type === "deep-dive" ? "deep-dive" : "story";
        var slug = String(it.slug || "").trim();
        var url = String(it.url || "");
        var hasUrl = /^https?:\/\//i.test(url);
        // A deep-dive card links to its own page (slug-based) instead of a
        // publisher URL; a story without a web link cannot be rendered.
        if (type === "deep-dive") {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue;
        } else if (!hasUrl) {
          continue;
        }
        clean.push({
          type: type,
          slug: slug,
          // The item's position in the RAW file — anchors (#story-<date>-<n>)
          // and the homepage strip are computed from the feed file itself, so
          // dropping malformed items must not shift later stories' anchors.
          feedIndex: j,
          title: String(it.title || "").trim() || "(untitled)",
          url: hasUrl ? url : "",
          source: String(it.source || "").trim(),
          tldr: String(it.tldr || "").trim(),
          summary: String(it.summary || "").trim(),
          details: (Array.isArray(it.details) ? it.details : [])
            .map(function (d) { return String(d == null ? "" : d).trim(); })
            .filter(Boolean),
          links: (Array.isArray(it.links) ? it.links : [])
            .filter(function (l) { return l && /^https?:\/\//i.test(String(l.url || "")); })
            .map(function (l) { return { label: String(l.label || "").trim(), url: String(l.url) }; }),
          industry: parseIndustries(it.industry),
          category: it.category === "ai" ? "ai" : it.category === "security" ? "security" : "news"
        });
      }
      out.push({ date: date, items: clean });
    }
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return { updated: raw.updated || (out[0] && out[0].date) || null, days: out };
  }

  function matches(item) {
    if (state.query) return searchMatches(item); // search bypasses tabs + industry
    if (state.filter === "all") return industryMatches(item);
    if (state.filter === "dive") return item.type === "deep-dive" && industryMatches(item);
    return item.category === state.filter && industryMatches(item);
  }

  // The second filter dimension: industry (NAICS sector). "unspecified"
  // selects the stories that carry no industry at all.
  function industryMatches(item) {
    if (state.industry === "all") return true;
    if (state.industry === "unspecified") return item.industry.length === 0;
    for (var i = 0; i < item.industry.length; i++)
      if (item.industry[i].name === state.industry) return true;
    return false;
  }

  /* Human label for a FILTER value (not a category badge — use catLabel). */
  function filterLabel(f) {
    return f === "ai" ? "AI Security" : f === "security" ? "Security" : f === "dive" ? "Deep dives" : null;
  }

  /* Both active filters in one readable phrase for the empty state. */
  function activeFilterLabel() {
    var parts = [];
    var topic = filterLabel(state.filter);
    if (topic) parts.push(topic);
    if (state.industry === "unspecified") parts.push("Unspecified industry");
    else if (state.industry !== "all") parts.push(state.industry);
    return parts.join(" + ");
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

  /* Industry pills — the NAICS sector name in a pill, like the category
     badge; the code rides the hover tooltip. No industries on the item means
     one dim "Unspecified" pill, the standing answer for "none assigned". */
  function industryPills(item) {
    var pills = [];
    if (item.industry.length) {
      for (var i = 0; i < item.industry.length; i++) {
        var ind = item.industry[i];
        var p = el("span", "badge ind", ind.name);
        p.title = ind.code ? "NAICS " + ind.code + " — " + ind.name : "Industry";
        pills.push(p);
      }
    } else {
      var u = el("span", "badge ind unspec", "Unspecified");
      u.title = "No industry assigned to this story";
      pills.push(u);
    }
    return pills;
  }

  function appendIndustryPills(meta, item) {
    var pills = industryPills(item);
    for (var i = 0; i < pills.length; i++) meta.appendChild(pills[i]);
  }

  /* A deep dive lives on its own generated page; the card is just the door. */
  function diveUrl(item) {
    return "/news/deep-dive/?s=" + encodeURIComponent(item.slug);
  }

  function diveHeadlineLink(item) {
    // Internal navigation — same tab, no rel, no ↗ (the CTA row sells the click).
    var a = el("a", "news-headline-link", item.title);
    a.href = diveUrl(item);
    return a;
  }

  function diveCardNode(item, art) {
    var meta = el("div", "news-meta");
    meta.appendChild(el("span", "badge dive", "Deep dive"));
    meta.appendChild(el("span", BADGE[item.category] || BADGE.news, catLabel(item.category)));
    appendIndustryPills(meta, item);
    if (item.source) meta.appendChild(el("span", "news-src", item.source));
    art.appendChild(meta);

    var h = el("h3", "news-headline");
    h.appendChild(diveHeadlineLink(item));
    art.appendChild(h);

    if (item.tldr) {
      var t = el("p", "news-tldr");
      t.appendChild(el("span", "lbl", "TL;DR"));
      t.appendChild(el("span", null, item.tldr));
      art.appendChild(t);
    }

    var cta = el("div", "news-dive-cta");
    var a = el("a", "news-dive-link", "Read the deep dive");
    a.href = diveUrl(item);
    var arr = el("span", "arrow", "→");
    arr.setAttribute("aria-hidden", "true");
    a.appendChild(arr);
    cta.appendChild(a);
    art.appendChild(cta);
    return art;
  }

  function articleNode(item, date, idx) {
    var art = el("article", "news-item " + (item.type === "deep-dive" ? "type-dive" : (TINT[item.category] || "")));
    // Anchor target for deep links (homepage strip): /news/#story-<date>-<n>
    // where <n> is the story's 1-based position in the feed's items array —
    // computed from the file, so the strip and this page always agree.
    // Search-only library dives carry no feed position and get no anchor,
    // so they can never collide with a real story's id.
    if (idx != null) art.id = "story-" + date + "-" + (idx + 1);

    if (item.type === "deep-dive") return diveCardNode(item, art);

    var meta = el("div", "news-meta");
    meta.appendChild(el("span", BADGE[item.category] || BADGE.news, catLabel(item.category)));
    appendIndustryPills(meta, item);
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

  function stateNode(title, body, retry, retryLabel) {
    var box = el("div", "news-state");
    box.appendChild(el("h3", null, title));
    box.appendChild(el("p", null, body));
    if (retry) {
      var b = el("button", "btn btn-ghost", retryLabel || "Try again");
      b.type = "button";
      b.addEventListener("click", function () {
        // "Try again" reloads the feed; the search empty state clears instead.
        if (state.query) clearSearch();
        else load();
      });
      box.appendChild(b);
    }
    return box;
  }

  /* ----------------------------------------------------------- rendering -- */

  function totalMatching() {
    var days = activeDays();
    var n = 0;
    for (var i = 0; i < days.length; i++)
      for (var j = 0; j < days[i].items.length; j++)
        if (matches(days[i].items[j])) n++;
    return n;
  }

  function render() {
    list.textContent = "";
    var controls = $("#news-controls");
    if (controls && controls.classList) controls.classList.toggle("searching", !!state.query);
    var total = totalMatching();

    if (total === 0) {
      if (state.query) {
        list.appendChild(stateNode(
          "No matches for \u201C" + state.rawQuery + "\u201D",
          "Nothing in the archive — stories or deep dives — contains every word. Fewer or shorter words reach further.",
          true,
          "Clear the search"
        ));
      } else {
        list.appendChild(stateNode(
          state.filter === "all" && state.industry === "all"
            ? "No briefings yet"
            : "Nothing filed under " + (activeFilterLabel() || "this filter") + " in the archive",
          state.filter === "all" && state.industry === "all"
            ? "The feed is live but empty. The first briefing lands with the next daily run — the page fills itself when it does."
            : "Switch back to All — or set the industry filter back to All industries; the archive has stories outside this slice."
        ));
      }
      var more0 = $("#news-more");
      if (more0) more0.hidden = true;
      var shown0 = $("#news-shown");
      if (shown0) shown0.hidden = true;
      return;
    }

    // Render newest-first until the story budget is spent. A day that
    // straddles the line shows its leading stories; the rest arrive with the
    // next "Load older briefings" click (or, while searching, the next page
    // of results). In search mode the days are the merged result view.
    var days = activeDays();
    var rendered = 0;
    for (var i = 0; i < days.length && rendered < state.shown; i++) {
      var day = days[i];
      var dayTotal = 0, j;
      for (j = 0; j < day.items.length; j++) if (matches(day.items[j])) dayTotal++;
      if (dayTotal === 0) continue;

      var showCount = Math.min(dayTotal, state.shown - rendered);
      var sec = el("section", "news-day");
      // Anchor target for deep links (homepage strip): /news/#day-<date>
      sec.id = "day-" + day.date;
      var head = el("div", "news-date");
      head.appendChild(el("h2", "news-date-d", dayLabel(day.date)));
      var tag = relativeTag(day.date);
      if (tag) head.appendChild(el("span", "news-date-tag", tag));
      head.appendChild(el("span", "news-date-count",
        showCount === dayTotal
          ? dayTotal + (dayTotal === 1 ? " story" : " stories")
          : showCount + " of " + dayTotal + " stories"));
      sec.appendChild(head);

      var wrap = el("div", "news-items");
      var shownHere = 0;
      for (j = 0; j < day.items.length && shownHere < showCount; j++) {
        var it = day.items[j];
        if (!matches(it)) continue;
        // The anchor index is the story's position in the feed FILE
        // (preserved through normalisation), so dropped items never shift
        // later anchors. A null feedIndex (search-only library dive) gets
        // no anchor at all.
        wrap.appendChild(articleNode(it, day.date, it.feedIndex != null ? it.feedIndex : null));
        shownHere++;
      }
      sec.appendChild(wrap);
      list.appendChild(sec);
      rendered += showCount;
    }

    var more = $("#news-more");
    if (more) more.hidden = rendered >= total;
    var shownLine = $("#news-shown");
    if (shownLine) {
      shownLine.hidden = false;
      if (state.query) {
        var suffix = state.divesState === "loading" ? " · loading the deep-dive library…"
          : state.divesState === "failed" ? " · the deep-dive library couldn't be loaded — feed results only"
          : "";
        shownLine.textContent = (rendered >= total
          ? total + (total === 1 ? " match" : " matches") + " for \u201C" + state.rawQuery + "\u201D"
          : "Showing " + rendered + " of " + total + " matches for \u201C" + state.rawQuery + "\u201D") + suffix;
      } else {
        shownLine.textContent = rendered >= total
          ? "Showing all " + total + " matching stories"
          : "Showing the latest " + rendered + " of " + total + " matching stories";
      }
    }

    // Layout changed (budget, filters, search view) — the back-to-top button
    // may need to appear or disappear.
    syncTopButton();
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
    rebuildIndustryFilter();
    rebuildJumpFilter();
  }

  /* The industry dropdown is the second filter dimension. Options are built
     from the feed itself — only sectors actually present, alphabetical, with
     counts — plus "Unspecified" when untagged stories exist. */
  function rebuildIndustryFilter() {
    var sel = $("#news-industry");
    if (!sel) return;
    var counts = {}, codes = {}, unspecified = 0;
    for (var i = 0; i < state.days.length; i++) {
      var items = state.days[i].items;
      for (var j = 0; j < items.length; j++) {
        var inds = items[j].industry;
        if (!inds.length) { unspecified++; continue; }
        for (var k = 0; k < inds.length; k++) {
          var name = inds[k].name;
          counts[name] = (counts[name] || 0) + 1;
          if (!codes[name]) codes[name] = inds[k].code;
        }
      }
    }
    var names = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });
    var prev = state.industry;
    sel.textContent = "";
    sel.appendChild(new Option("All industries", "all"));
    for (var x = 0; x < names.length; x++) {
      var nm = names[x];
      sel.appendChild(new Option(nm + " (" + counts[nm] + ")", nm));
      if (codes[nm]) sel.lastChild.title = "NAICS " + codes[nm] + " — " + nm;
    }
    if (unspecified) sel.appendChild(new Option("Unspecified (" + unspecified + ")", "unspecified"));
    sel.value = prev;
    if (sel.selectedIndex === -1) { // the chosen industry aged out of the feed
      state.industry = "all";
      sel.value = "all";
    }
  }

  /* ------------------------------- jump to a published day (website-rbw) --
     The dropdown lists every day in the feed; picking one expands the render
     window until that day is fully on the page (the same budget expansion
     deep links use), then scrolls to its #day-<date> anchor. The selection
     also follows #day-/#story- hash landings, so the dropdown always shows
     the day the reader is looking at. */
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function dayMatchingCount(date) {
    for (var i = 0; i < state.days.length; i++) {
      if (state.days[i].date !== date) continue;
      var n = 0;
      for (var j = 0; j < state.days[i].items.length; j++)
        if (matches(state.days[i].items[j])) n++;
      return n;
    }
    return 0;
  }

  // A day counts as fully rendered when its section exists and shows every
  // story the current filters let through (the budget may have cut it off).
  function dayFullyRendered(date) {
    var sec = document.getElementById("day-" + date);
    if (!sec) return false;
    return sec.querySelectorAll(".news-item").length >= dayMatchingCount(date);
  }

  function jumpToDay(date) {
    if (!date) return;
    state.jumpDay = date;
    var guard = 80; // ~80 × 15 stories is far past the 90-day cap; belt and braces
    while (!dayFullyRendered(date) && state.shown < totalMatching() && guard-- > 0) {
      state.shown += BUDGET;
      render();
    }
    var sec = document.getElementById("day-" + date);
    if (sec) sec.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    syncJumpControls();
  }

  function syncJumpControls() {
    var sel = $("#news-jump");
    if (sel && state.jumpDay) {
      sel.value = state.jumpDay;
      if (sel.selectedIndex === -1) sel.value = ""; // aged out of the feed
    }
  }

  /* Options are built from the feed itself, like the industry dropdown:
     every day, newest first, with "Today"/"Yesterday" tags and story counts. */
  function rebuildJumpFilter() {
    var sel = $("#news-jump");
    if (!sel) return;
    sel.textContent = "";
    sel.appendChild(new Option("Jump to a day…", ""));
    for (var i = 0; i < state.days.length; i++) {
      var day = state.days[i];
      var tag = relativeTag(day.date);
      var label = (tag ? tag + " — " : "") + (dayLabel(day.date) || day.date) +
        " · " + day.items.length + (day.items.length === 1 ? " story" : " stories");
      sel.appendChild(new Option(label, day.date));
    }
    sel.value = state.jumpDay || "";
    if (sel.selectedIndex === -1) sel.value = "";
    syncJumpControls();
  }

  /* ------------------- search across stories & deep dives (website-dta) ----
     Plain case-insensitive substring search over every text field the
     renderer shows. Several words all have to appear (AND); no stemming, no
     ranking — predictable beats clever. While a query is active the whole
     archive is searched and the topic/industry filters are bypassed; clearing
     the box restores the previous view exactly. deep-dives.json is fetched
     lazily on the first keystroke (it is append-only and far bigger than the
     feed) and cached; a failed fetch degrades to feed-only results. */
  function searchMatches(item) {
    var hay = itemHaystack(item);
    for (var i = 0; i < state.queryTerms.length; i++)
      if (hay.indexOf(state.queryTerms[i]) === -1) return false;
    return state.queryTerms.length > 0;
  }

  // One lowercase blob per item, built on first use and cached. Links
  // contribute their labels (not raw URLs); industries their sector names.
  function itemHaystack(item) {
    if (item._hay) return item._hay;
    var parts = [item.title, item.source, item.tldr, item.summary];
    for (var i = 0; i < item.details.length; i++) parts.push(item.details[i]);
    for (var j = 0; j < item.links.length; j++) parts.push(item.links[j].label || "");
    for (var k = 0; k < item.industry.length; k++) parts.push(item.industry[k].name);
    item._hay = parts.join(" ").toLowerCase();
    return item._hay;
  }

  // A library dive with no feed card (its day aged out of the 90-day feed,
  // but the library is append-only and forever) becomes a search-only card:
  // same shape as a feed deep-dive item, but feedIndex stays null so
  // articleNode leaves the #story- anchors alone. Cached on the dive.
  function libDiveToItem(dive) {
    if (dive._viewItem) return dive._viewItem;
    var item = {
      type: "deep-dive",
      slug: String(dive.slug || "").trim(),
      feedIndex: null,
      title: String(dive.title || "").trim() || "(untitled)",
      url: "",
      source: String(dive.source || "").trim(),
      tldr: String(dive.tldr || "").trim(),
      summary: String(dive.summary || "").trim(),
      details: (Array.isArray(dive.details) ? dive.details : [])
        .map(function (d) { return String(d == null ? "" : d).trim(); })
        .filter(Boolean),
      links: (Array.isArray(dive.links) ? dive.links : [])
        .filter(function (l) { return l && /^https?:\/\//i.test(String(l.url || "")); })
        .map(function (l) { return { label: String(l.label || "").trim(), url: String(l.url) }; }),
      industry: parseIndustries(dive.industry),
      category: dive.category === "ai" ? "ai" : dive.category === "security" ? "security" : "news"
    };
    dive._viewItem = item;
    return item;
  }

  // The search view: every matching feed item plus matching library dives
  // whose slug has no feed card anymore, grouped by date, newest day first —
  // so results render through the exact same day-section path as the feed.
  function buildSearchDays() {
    var byDate = {}, order = [], feedSlugs = {};
    var push = function (date, item) {
      if (!byDate[date]) { byDate[date] = []; order.push(date); }
      byDate[date].push(item);
    };
    for (var i = 0; i < state.days.length; i++) {
      var day = state.days[i];
      for (var j = 0; j < day.items.length; j++) {
        if (day.items[j].type === "deep-dive") feedSlugs[day.items[j].slug] = true;
        if (searchMatches(day.items[j])) push(day.date, day.items[j]);
      }
    }
    if (state.dives) {
      for (var d = 0; d < state.dives.length; d++) {
        var dive = state.dives[d];
        if (!dive || feedSlugs[dive.slug] || !/^[a-z0-9][a-z0-9-]*$/.test(String(dive.slug || ""))) continue;
        var item = libDiveToItem(dive);
        if (searchMatches(item)) push(String(dive.date || ""), item);
      }
    }
    order.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    var out = [];
    for (var o = 0; o < order.length; o++) out.push({ date: order[o], items: byDate[order[o]] });
    return out;
  }

  // Everything downstream (counts, the render loop) reads the view: the feed,
  // or the merged search results while a query is active.
  function activeDays() {
    return state.query ? buildSearchDays() : state.days;
  }

  function applyQuery(raw) {
    var q = String(raw || "").trim().toLowerCase();
    state.rawQuery = raw;
    state.query = q;
    state.queryTerms = q ? q.split(/\s+/) : [];
    state.shown = BUDGET;
    var controls = $("#news-controls");
    if (controls && controls.classList) controls.classList.toggle("searching", !!state.query);
    var clearBtn = $("#news-search-clear");
    if (clearBtn) clearBtn.hidden = !state.query;
    // The library rides along on the first real query — never on page load.
    if (state.query && state.divesState === "") {
      state.divesState = "loading";
      fetch("/news/deep-dives.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          state.dives = data && Array.isArray(data.dives) ? data.dives : [];
          state.divesState = "loaded";
          render(); // library results arrived — fold them in if a query is still active
        })
        .catch(function () {
          state.divesState = "failed";
          render(); // degrade to feed-only results; the shown line carries the note
        });
    }
    syncCloud(); // a cloud name just clicked (or cleared) — move the highlight
    render();
  }

  function clearSearch() {
    if (searchInput) searchInput.value = "";
    state.query = "";
    state.rawQuery = "";
    state.queryTerms = [];
    state.shown = BUDGET;
    var controls = $("#news-controls");
    if (controls && controls.classList) controls.classList.remove("searching");
    var clearBtn = $("#news-search-clear");
    if (clearBtn) clearBtn.hidden = true;
    syncCloud(); // the highlight leaves the cloud with the search
    render();
  }

  /* ----------------- word cloud: proper names across the stories ----------
     The most-mentioned proper names in the feed — tools, platforms,
     attacks, operations, agencies (Anthropic, ARTEX, ConnectWise, CISA…) —
     rendered as buttons sized by how many stories mention them. No
     dependencies and no name list to maintain: candidacy comes from the
     prose itself. A click feeds the name into the exact same path as the
     search box (applyQuery): the archive is substring-searched, the
     deep-dive library rides along lazily, and the matching stories render
     in the list below. Built once per feed load; counts are whole-archive,
     so the cloud itself does not move while a filter or search is active —
     the active name lights up instead (syncCloud).

     What counts as a name: a run of adjacent capitalized, mixed-case or
     all-caps tokens (Claude Code, PHP2Shell); digits ride along (Unit 42).
     A lone Capitalized word is only evidence mid-sentence — a sentence may
     open with any capitalized word — while an ALL-CAPS token counts
     anywhere (CISA, ARTEX). Three corrections keep the house style from
     poisoning the pool:

     1. Titles are title-case throughout, so they never nominate candidates;
        they only add mention counts to names proven in the prose.
     2. The writer's bullets open with a title-case label ("Customer
        guidance: …", "Restoration status: …"). A short capitalized phrase
        before the first colon is a label, never a name, and the text after
        the colon reads as a fresh sentence. All-caps tokens inside a label
        still count (KEV timing:, RCE checklist:).
     3. Generic class words, demonyms and unit acronyms (security,
        ransomware, chinese, utc, rce) are blocklisted below — they pass
        every case test and are still not names.

     Keys stay lowercase (they must match the search and the active
     highlight); the button shows the most common casing seen. Mentions are
     counted per story — a story repeating a name thirty times counts once —
     so the tooltip "N stories" is exact. */
  var CLOUD_WORDS = 60;  // how many names make the cloud — the knob
  var CLOUD_MIN_PX = 12; // smallest cloud name
  var CLOUD_MAX_PX = 27; // largest cloud name
  var CLOUD_GROW = 1.2;       // hover scale on the name under the pointer
  var CLOUD_GAP = 3;          // breathing room the yield pass keeps clear
  var CLOUD_PUSH_MAX = 20;    // how far a name will slide out of the way
  var CLOUD_PASSES = 3;       // relaxation rounds for cascading pushes
  var CLOUD_TOKEN = /[A-Za-z0-9][A-Za-z0-9'’&-]*(?:\.[A-Za-z0-9][A-Za-z0-9'’&-]*)*/g;
  var CLOUD_STOP = {
    // standard English function words
    a: 1, about: 1, above: 1, after: 1, again: 1, against: 1, all: 1, an: 1, and: 1,
    any: 1, are: 1, as: 1, at: 1, be: 1, because: 1, been: 1, before: 1, being: 1,
    below: 1, between: 1, both: 1, but: 1, by: 1, can: 1, did: 1, do: 1, does: 1,
    doing: 1, down: 1, during: 1, each: 1, few: 1, for: 1, from: 1, further: 1,
    had: 1, has: 1, have: 1, having: 1, he: 1, her: 1, here: 1, hers: 1, him: 1,
    his: 1, how: 1, if: 1, in: 1, into: 1, is: 1, it: 1, its: 1, itself: 1, just: 1,
    me: 1, more: 1, most: 1, my: 1, no: 1, nor: 1, not: 1, now: 1, of: 1, off: 1,
    on: 1, once: 1, only: 1, or: 1, other: 1, our: 1, ours: 1, out: 1, over: 1,
    own: 1, same: 1, she: 1, should: 1, so: 1, some: 1, such: 1, than: 1, that: 1,
    the: 1, their: 1, theirs: 1, them: 1, then: 1, there: 1, these: 1, they: 1,
    this: 1, those: 1, through: 1, to: 1, too: 1, under: 1, until: 1, up: 1, very: 1,
    was: 1, we: 1, were: 1, what: 1, when: 1, where: 1, which: 1, while: 1, who: 1,
    whom: 1, why: 1, will: 1, with: 1, would: 1, you: 1, your: 1, yours: 1,
    // news-wire filler: no topic signal in this archive
    says: 1, said: 1, say: 1, new: 1, amid: 1, per: 1, via: 1, also: 1, among: 1,
    according: 1, report: 1, reports: 1, reported: 1, latest: 1, week: 1, update: 1,
    one: 1, two: 1, three: 1, first: 1, back: 1, still: 1, may: 1, might: 1, must: 1,
    get: 1, got: 1, make: 1, made: 1, use: 1, used: 1, using: 1,
    // house-bullet boilerplate: the CONFIRMED/REPORTED/UNVERIFIED prefixes and
    // the verbs every timeline bullet leans on — noise at cloud scale
    confirmed: 1, unverified: 1, unconfirmed: 1, returned: 1, exposed: 1,
    affected: 1, found: 1, including: 1, single: 1, hours: 1, across: 1,
    company: 1, utc: 1, gmt: 1, since: 1, published: 1, accessed: 1,
    // calendar words: deep-dive timelines date everything, prose style is
    // "From Oct 28" — none of it is a name
    jan: 1, feb: 1, mar: 1, apr: 1, jun: 1, jul: 1, aug: 1, sep: 1, sept: 1,
    oct: 1, nov: 1, dec: 1, january: 1, february: 1, march: 1, april: 1, june: 1,
    july: 1, august: 1, september: 1, october: 1, november: 1, december: 1,
    monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1,
    sunday: 1,
    // class words & jargon: capitalized constantly, still not names
    security: 1, group: 1, information: 1, secrets: 1, framework: 1,
    ransomware: 1, patch: 1, actions: 1, requests: 1, critical: 1,
    enterprise: 1, research: 1, cyber: 1, online: 1, ledger: 1, pro: 1,
    technology: 1, cvss: 1, ips: 1, node: 1, independent: 1, irregular: 1,
    inference: 1, rce: 1, ai: 1, api: 1, url: 1, uri: 1, ip: 1, ids: 1,
    iam: 1, sso: 1, mfa: 1, vpn: 1, rss: 1, html: 1, css: 1, js: 1, json: 1,
    llm: 1, nlp: 1, ceo: 1, cto: 1, ciso: 1, cio: 1, cfo: 1, tl: 1, dr: 1,
    eg: 1, ie: 1, vs: 1, etc: 1,
    // demonyms & compass adjectives: attributes of actors, not actors
    chinese: 1, korean: 1, japanese: 1, russian: 1, american: 1, british: 1,
    israeli: 1, iranian: 1, ukrainian: 1, european: 1, german: 1, french: 1,
    indian: 1, north: 1, south: 1,
    // clocks & units: timestamps and measurements, not names
    am: 1, pm: 1, et: 1, pt: 1, edt: 1, cdt: 1, pdt: 1, mst: 1, jst: 1,
    post: 1, hf: 1,
    // more words that pass every case test and are still not names
    c2: 1, cli: 1, vps: 1, cve: 1, go: 1, act: 1, brief: 1, daily: 1,
    advanced: 1, system: 1, id: 1, ioc: 1, iocs: 1, put: 1,
    ci: 1, cd: 1, saas: 1, active: 1, actively: 1, state: 1, super: 1
  };
  // Words that compose names ("Active Cyber Defense", "Department of
  // Justice", "TRM Labs"): they may sit INSIDE a run as connectors, but a
  // run may neither start nor end with them — trailing ones are trimmed —
  // and they can never be a name by themselves.
  var CLOUD_CONNECT = {
    the: 1, of: 1, for: 1, de: 1, von: 1, van: 1,
    cyber: 1, security: 1, group: 1, defense: 1, defence: 1, labs: 1,
    information: 1, technology: 1, research: 1, agency: 1, agencies: 1,
    center: 1, centre: 1, institute: 1, department: 1, division: 1,
    national: 1, federal: 1, intelligence: 1, threat: 1, task: 1, force: 1,
    team: 1, network: 1, networks: 1, systems: 1, solutions: 1, software: 1
  };
  // Names pinned into the cloud regardless of the word-level rules — a
  // stoplisted word ("super") would otherwise dissolve the run. Key: the
  // lowercase phrase the counting matches; value: the canonical display
  // casing. The case-true rule still applies: lowercase prose never counts.
  var CLOUD_PINNED = {
    "super intelligence force": "Super Intelligence Force"
  };

  function cloudStrip(t) {
    return t.replace(/[’']s$/, "").replace(/^[-'’]+|[-'’]+$/g, "");
  }

  function cloudNameLike(t) {
    if (t.length < 2 || !/[A-Z]/.test(t)) return false;
    var low = t.toLowerCase();
    if (CLOUD_STOP[low] || CLOUD_CONNECT[low]) return false;
    // "Chinese-language", "AI-agent": a hyphenated token headed by a
    // stoplisted word is an adjective, not a name.
    var head = low.split("-")[0];
    return !(low.indexOf("-") > -1 && CLOUD_STOP[head]);
  }

  function cloudIsAllCaps(t) {
    return /^[A-Z0-9&.-]+$/.test(t) && /[A-Z]/.test(t);
  }

  // Record one candidate run: the key is the lowercase join (it must match
  // the search and the active highlight), the surface casing is voted on.
  function cloudNominate(pool, parts) {
    var key = parts.map(cloudStrip).join(" ").toLowerCase();
    if (!/[a-z]/.test(key)) return; // digits only — no name
    var surf = parts.map(cloudStrip).join(" ");
    if (!pool[key]) pool[key] = { disp: {}, singles: parts.length === 1 };
    pool[key].disp[surf] = (pool[key].disp[surf] || 0) + 1;
  }

  // One sentence's tokens: adjacent name-like tokens form a run; connective
  // words may sit inside a run ("Department of Justice") and digits may
  // extend one ("Unit 42") — neither may start a run, and trailing
  // connectors are trimmed on flush. A lone capitalized word is only
  // evidence mid-sentence; ALL-CAPS is evidence anywhere. Breakers (the
  // stoplist) end a run unconditionally.
  function cloudScanTokens(pool, toks, atSentenceStart) {
    var run = [], runAtStart = atSentenceStart;
    var flush = function () {
      if (run.length) {
        while (run.length && !cloudNameLike(run[run.length - 1]) &&
               !/^[0-9][0-9.-]*$/.test(run[run.length - 1])) run.pop();
        if (run.length) {
          if (run.length >= 2) cloudNominate(pool, run);
          else if (!runAtStart || cloudIsAllCaps(run[0])) cloudNominate(pool, run);
        }
        run = [];
      }
    };
    for (var i = 0; i < toks.length; i++) {
      var t = cloudStrip(toks[i]);
      if (!t) { flush(); continue; }
      if (cloudNameLike(t)) { run.push(t); continue; }
      var low = t.toLowerCase();
      if (CLOUD_STOP[low]) { flush(); runAtStart = false; continue; }
      if (CLOUD_CONNECT[low] && run.length) { run.push(t); continue; }
      if (/^[0-9][0-9.-]*$/.test(t) && run.length) { run.push(t); continue; }
      flush();
      runAtStart = false;
    }
    flush();
  }

  // Prose pass. A short capitalized phrase before the first colon is the
  // writer's bullet label ("Customer guidance: …") — never a name; the text
  // after the colon reads as a fresh sentence. All-caps inside a label
  // still counts (KEV timing:, RCE checklist:).
  function cloudScanProse(pool, text) {
    var chunks = String(text || "").match(/[^.!?…\n]+[.!?…]*/g) || [];
    for (var c = 0; c < chunks.length; c++) {
      var ch = chunks[c];
      var colon = ch.indexOf(":");
      if (colon > -1) {
        var labelToks = ch.slice(0, colon).match(CLOUD_TOKEN) || [];
        if (labelToks.length <= 6) {
          for (var l = 0; l < labelToks.length; l++) {
            var lt = cloudStrip(labelToks[l]);
            if (cloudIsAllCaps(lt) && lt.length > 1 && !CLOUD_STOP[lt.toLowerCase()])
              cloudNominate(pool, [lt]);
          }
          ch = ch.slice(colon + 1);
        }
      }
      var sents = ch.match(/[^.!?…]+[.!?…]*/g) || [ch];
      for (var i = 0; i < sents.length; i++) {
        // Commas, semicolons, slashes, dashes and spaced hyphens separate
        // names as surely as periods do — "OpenAI/Anthropic" is two names,
        // not one run. Only the first segment counts as sentence-initial.
        var parts = sents[i].split(/[,;\/—–]+|\s-\s/);
        for (var s = 0; s < parts.length; s++)
          cloudScanTokens(pool, parts[s].match(CLOUD_TOKEN) || [], s === 0);
      }
    }
  }

  function buildCloud() {
    var box = $("#news-cloud-words");
    var wrap = $("#news-cloud");
    if (!box || !wrap) return;
    // Pass 1 — candidacy: what can be a name at all. Only the prose
    // nominates (titles are title-case throughout and prove nothing).
    var pool = {};
    for (var pinned in CLOUD_PINNED)
      pool[pinned] = { disp: {}, singles: false, pinned: CLOUD_PINNED[pinned] };
    var nominate = function (parts) { cloudNominate(pool, parts); };
    for (var i = 0; i < state.days.length; i++)
      for (var j = 0; j < state.days[i].items.length; j++) {
        var it = state.days[i].items[j];
        cloudScanProse(pool, it.tldr);
        cloudScanProse(pool, it.summary);
        for (var k = 0; k < it.details.length; k++) cloudScanProse(pool, it.details[k]);
      }
    // Pass 2 — mentions per story: a name counts once per story that
    // contains it, so a story repeating a name thirty times cannot dominate
    // the sizes and the "N stories" tooltip is exact. Prose counts
    // longest-match runs; titles count proven single-token names only.
    var stories = {};
    for (i = 0; i < state.days.length; i++)
      for (j = 0; j < state.days[i].items.length; j++) {
        var item = state.days[i].items[j];
        var seen = {};
        var mark = function (key) {
          if (!seen[key]) { seen[key] = 1; stories[key] = (stories[key] || 0) + 1; }
        };
        var fields = [item.tldr, item.summary];
        for (k = 0; k < item.details.length; k++) fields.push(item.details[k]);
        for (k = 0; k < fields.length; k++) {
          var chunks = String(fields[k] || "").match(/[^.!?…\n]+[.!?…]*/g) || [];
          for (var c = 0; c < chunks.length; c++) {
            var raws = chunks[c].match(CLOUD_TOKEN) || [];
            var toks = [], caps = [];
            for (var r = 0; r < raws.length; r++) {
              var st = cloudStrip(raws[r]);
              if (st) { toks.push(st); caps.push(/[A-Z]/.test(st) || /^[0-9]/.test(st)); }
            }
            var p = 0;
            while (p < toks.length) {
              var hit = 0;
              for (var len = Math.min(4, toks.length - p); len >= 1; len--) {
                // A name key only counts where the text actually spells it
                // with a capital (or a number): "state AI laws" must not
                // count toward the State that "Michigan State University"
                // proved. Every matched token needs its own uppercase.
                var okCaps = true;
                for (var q = 0; q < len; q++) if (!caps[p + q]) { okCaps = false; break; }
                if (!okCaps) continue;
                var key = toks.slice(p, p + len).join(" ").toLowerCase();
                if (pool[key]) { mark(key); hit = len; break; }
              }
              p += hit || 1;
            }
          }
        }
        var titleToks = String(item.title || "").match(CLOUD_TOKEN) || [];
        for (r = 0; r < titleToks.length; r++) {
          var tk = cloudStrip(titleToks[r]).toLowerCase();
          if (pool[tk] && pool[tk].singles) mark(tk);
        }
      }
    var names = Object.keys(stories);
    // Most stories first, ties alphabetical — predictable beats clever.
    names.sort(function (a, b) { return stories[b] - stories[a] || (a < b ? -1 : a > b ? 1 : 0); });
    names = names.slice(0, CLOUD_WORDS);
    if (!names.length) return; // an empty feed leaves the cloud hidden
    var hi = stories[names[0]], lo = stories[names[names.length - 1]];
    box.textContent = "";
    // DOM order is alphabetical: screen readers and keyboard users read the
    // cloud predictably no matter where the spiral drops each name.
    names.sort();
    cloudEntries = [];
    for (var w = 0; w < names.length; w++) {
      var name = names[w], n = stories[name];
      var size = hi === lo ? CLOUD_MAX_PX
        : Math.round(CLOUD_MIN_PX + ((n - lo) / (hi - lo)) * (CLOUD_MAX_PX - CLOUD_MIN_PX));
      var disp = name, best = -1, votes = pool[name].disp;
      for (var surf in votes) if (votes[surf] > best) { best = votes[surf]; disp = surf; }
      if (pool[name].pinned) disp = pool[name].pinned;
      var b = el("button", "news-cloud-word", disp);
      b.type = "button";
      b.setAttribute("data-word", name);
      b.title = n + (n === 1 ? " story mentions " : " stories mention ") + "\u201C" + disp + "\u201D";
      b.setAttribute("aria-label", "Search the archive for " + disp + " (" + n + (n === 1 ? " story" : " stories") + ")");
      b.addEventListener("click", function () {
        if (searchInput) searchInput.value = this.getAttribute("data-word");
        var clearBtn = $("#news-search-clear");
        if (clearBtn) clearBtn.hidden = false;
        applyQuery(this.getAttribute("data-word"));
      });
      cloudEntries.push({ btn: b, size: size, jitter: 0 });
      box.appendChild(b);
    }
    // The cloud only shows when the toggle is open (hidden by default on
    // every load); layout runs regardless — it no-ops while hidden.
    wrap.hidden = !cloudIsOpen();
    cloudLayout();
  }

  // Cloud visibility lives on the toggle's aria-expanded: the button is the
  // single source of truth for open/closed, and screen readers get the
  // state for free. No persistence — the cloud starts hidden every load.
  function cloudIsOpen() {
    var btn = $("#news-cloud-toggle");
    return !!(btn && btn.getAttribute("aria-expanded") === "true");
  }

  function cloudSetOpen(open) {
    var btn = $("#news-cloud-toggle");
    var wrap = $("#news-cloud");
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      var chev = btn.querySelector(".chev");
      if (chev) chev.textContent = open ? " ▾" : " ▸";
    }
    if (!wrap) return;
    if (!open || !cloudEntries || !cloudEntries.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    cloudLayout(); // clientWidth was 0 while hidden — re-place for real now
  }

  // The active search name lights up in the cloud — the lowercase key must
  // match exactly, so a hand-typed multi-word query has no single owner in
  // the cloud.
  function syncCloud() {
    var box = $("#news-cloud-words");
    if (!box) return;
    var kids = box.children;
    for (var i = 0; i < kids.length; i++)
      kids[i].className = "news-cloud-word" +
        (kids[i].getAttribute("data-word") === state.query ? " active" : "");
  }

  /* ------------------------- cloud layout: the spiral ---------------------
     Names are dropped onto an expanding spiral from the container's center,
     largest first, each at the first overlap-free spot — the classic word
     cloud technique (wordcloud2.js / d3-cloud territory), rewritten as
     plain ES5: no canvas, no dependencies. The arrangement is seeded from
     the feed's newest day, so it looks organic but holds still for the
     whole day — no reshuffling on every reload. If names cannot all fit
     (narrow screens), sizes shrink and the container grows a little across
     five attempts; whatever still does not fit is left out rather than
     allowed to overlap. */
  var cloudEntries = null;

  function cloudSeed() {
    var s = String(state.updated || "sorklin"), h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
    return h;
  }

  function cloudRng(seed) {
    return function () {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }

  function cloudLayout() {
    if (!cloudEntries || !cloudEntries.length) return;
    var box = $("#news-cloud-words");
    if (!box || !box.clientWidth) return;
    var rng = cloudRng(cloudSeed());
    var theta0 = rng() * Math.PI * 2, dir = rng() < 0.5 ? 1 : -1;
    for (var i = 0; i < cloudEntries.length; i++) cloudEntries[i].jitter = rng();
    box.style.height = "";
    var baseH = box.clientHeight || 210;
    var attempt, scale, H;
    for (attempt = 0; attempt < 5; attempt++) {
      scale = 1 - attempt * 0.15;
      H = Math.round(baseH * (1 + 0.18 * attempt));
      box.style.height = H + "px";
      var W = box.clientWidth;
      for (i = 0; i < cloudEntries.length; i++) {
        var e = cloudEntries[i];
        e.btn.style.display = "";
        e.btn.style.transform = ""; // a repack never fights a hover
        e.ox = 0;
        e.oy = 0;
        e.btn.style.fontSize = Math.max(9, Math.round(e.size * scale)) + "px";
        e.w = e.btn.offsetWidth;
        e.h = e.btn.offsetHeight;
        e.pos = null;
      }
      // Largest first — big names need the roomiest part of the spiral.
      var order = cloudEntries.slice(0).sort(function (a, b) {
        return b.size - a.size || b.jitter - a.jitter || b.w - a.w;
      });
      var placed = [], ok = true;
      for (i = 0; i < order.length; i++) {
        var f = order[i];
        var spot = cloudSpot(W, H, f.w, f.h, theta0, dir, placed);
        if (!spot) { ok = false; continue; }
        f.pos = spot;
        placed.push({ x1: spot[0], y1: spot[1], x2: spot[0] + f.w, y2: spot[1] + f.h });
      }
      if (ok) break;
    }
    cloudSpread(cloudEntries, W, H);
    for (i = 0; i < cloudEntries.length; i++) {
      var e = cloudEntries[i];
      if (e.pos) {
        e.btn.style.left = e.pos[0] + "px";
        e.btn.style.top = e.pos[1] + "px";
      } else {
        e.btn.style.display = "none"; // did not fit — better absent than overlapping
      }
    }
  }

  /* The spiral packs tight around the center; this stretches the finished
     arrangement so the cloud spans the full content width. Centers are
     mapped linearly from the placed bounding box onto the whole container
     (minus a small pad) — gaps only ever grow, so no new overlaps are
     possible, and name sizes are untouched. */
  function cloudSpread(entries, W, H) {
    var pad = 3, x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9, i, e;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (!e.pos) continue;
      if (e.pos[0] < x1) x1 = e.pos[0];
      if (e.pos[1] < y1) y1 = e.pos[1];
      if (e.pos[0] + e.w > x2) x2 = e.pos[0] + e.w;
      if (e.pos[1] + e.h > y2) y2 = e.pos[1] + e.h;
    }
    var bw = x2 - x1, bh = y2 - y1;
    if (bw <= 0 || bh <= 0) return;
    var sx = (W - 2 * pad) / bw, sy = (H - 2 * pad) / bh;
    if (sx <= 1 && sy <= 1) return; // already spans the container
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (!e.pos) continue;
      var ncx = pad + (e.pos[0] + e.w / 2 - x1) * sx;
      var ncy = pad + (e.pos[1] + e.h / 2 - y1) * sy;
      e.pos = [Math.round(ncx - e.w / 2), Math.round(ncy - e.h / 2)];
    }
  }

  // Walk the spiral; return the first [left, top] where the word's box fits
  // inside the container and clear of everything already placed.
  function cloudSpot(W, H, w, h, theta0, dir, placed) {
    var cx = W / 2, cy = H / 2, g = 2, pad = 3;
    var maxR = Math.sqrt(W * W + H * H) / 2 + 10;
    for (var t = 0; ; t++) {
      var th = theta0 + dir * t * 0.25;
      var r = 2 + t * 0.9;
      if (r > maxR) return null; // the spiral has left the container
      var x = cx + Math.cos(th) * r;
      var y = cy + Math.sin(th) * r * 0.62; // squash vertically: wide pages
      var x1 = x - w / 2, y1 = y - h / 2, x2 = x1 + w, y2 = y1 + h;
      if (x1 < pad || y1 < pad || x2 > W - pad || y2 > H - pad) continue;
      var clear = true;
      for (var i = 0; i < placed.length; i++) {
        var b = placed[i];
        if (!(x1 > b.x2 + g || x2 < b.x1 - g || y1 > b.y2 + g || y2 < b.y1 - g)) { clear = false; break; }
      }
      if (clear) return [Math.round(x1), Math.round(y1)];
    }
  }

  /* ------------------------ cloud hover: grow and yield -------------------
     The name under the pointer (or keyboard focus) scales up around its
     center; neighbours whose home boxes it now invades slide away along
     their shallowest-overlap axis, a few capped passes so pushes cascade.
     Everything is a transform: no reflow, no measuring at hover time, and
     cloudRest() returns the whole cloud to its seeded home layout. Under
     prefers-reduced-motion the transitions switch off (CSS) and the same
     math applies instantly. */
  var cloudHot = null;

  function cloudRest() {
    cloudHot = null;
    if (!cloudEntries) return;
    for (var i = 0; i < cloudEntries.length; i++) {
      var e = cloudEntries[i];
      e.btn.style.transform = "";
      e.ox = 0;
      e.oy = 0;
    }
  }

  function cloudGrow(entry) {
    if (cloudHot === entry || !cloudEntries) return;
    cloudRest();
    cloudHot = entry;
    entry.btn.style.transform = "scale(" + CLOUD_GROW + ")";
    cloudYield(entry);
  }

  function cloudYield(grown) {
    var gw = grown.w * CLOUD_GROW, gh = grown.h * CLOUD_GROW;
    var gcx = grown.pos[0] + grown.w / 2, gcy = grown.pos[1] + grown.h / 2;
    var g1x = gcx - gw / 2 - CLOUD_GAP, g1y = gcy - gh / 2 - CLOUD_GAP;
    var g2x = gcx + gw / 2 + CLOUD_GAP, g2y = gcy + gh / 2 + CLOUD_GAP;
    for (var pass = 0; pass < CLOUD_PASSES; pass++) {
      var moved = false;
      for (var i = 0; i < cloudEntries.length; i++) {
        var e = cloudEntries[i];
        if (e === grown || !e.pos) continue;
        var x1 = e.pos[0] + e.ox, y1 = e.pos[1] + e.oy;
        var x2 = x1 + e.w, y2 = y1 + e.h;
        if (x1 >= g2x || x2 <= g1x || y1 >= g2y || y2 <= g1y) continue;
        var px = (e.pos[0] + e.w / 2) < gcx ? -1 : 1;
        var py = (e.pos[1] + e.h / 2) < gcy ? -1 : 1;
        var ox = Math.min(x2, g2x) - Math.max(x1, g1x);
        var oy = Math.min(y2, g2y) - Math.max(y1, g1y);
        if (ox <= 0 && oy <= 0) continue;
        if (ox < oy) e.ox += px * ox; else e.oy += py * oy;
        if (e.ox > CLOUD_PUSH_MAX) e.ox = CLOUD_PUSH_MAX;
        if (e.ox < -CLOUD_PUSH_MAX) e.ox = -CLOUD_PUSH_MAX;
        if (e.oy > CLOUD_PUSH_MAX) e.oy = CLOUD_PUSH_MAX;
        if (e.oy < -CLOUD_PUSH_MAX) e.oy = -CLOUD_PUSH_MAX;
        e.btn.style.transform = "translate(" + e.ox + "px," + e.oy + "px)";
        moved = true;
      }
      if (!moved) break;
    }
  }

  function recomputeCounts() {
    var c = { all: 0, security: 0, ai: 0, dive: 0 };
    for (var i = 0; i < state.days.length; i++) {
      for (var j = 0; j < state.days[i].items.length; j++) {
        var it = state.days[i].items[j];
        var cat = it.category;
        c.all++;
        if (c[cat] != null) c[cat]++;
        if (it.type === "deep-dive") c.dive++;
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
      state.shown = BUDGET;
      for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-pressed", tabs[i] === btn ? "true" : "false");
      render();
    });
  }

  var indSel = $("#news-industry");
  if (indSel) {
    indSel.addEventListener("change", function () {
      state.industry = this.value || "all";
      state.shown = BUDGET;
      render();
    });
  }

  var jumpSel = $("#news-jump");
  if (jumpSel) {
    jumpSel.addEventListener("change", function () {
      if (this.value && !state.query) jumpToDay(this.value); // inert while searching
    });
  }

  /* ----------------- back to the top of the feed (fixed bottom right) -----
     Appears once the filter/search row has scrolled off the viewport — after
     a jump to a far-back day the trip home is long — and clicking scrolls
     back to that row. Hidden until then: before the feed loads, on error
     states, and without JavaScript (the button never leaves the markup). */
  var topBtn = $("#news-top");
  function syncTopButton() {
    if (!topBtn) return;
    var controls = $("#news-controls");
    if (!controls || controls.hidden) { topBtn.hidden = true; return; }
    // Show only when the whole controls row is above the viewport: while any
    // part of it is still on screen the reader can use it directly.
    topBtn.hidden = controls.getBoundingClientRect().bottom > 0;
  }
  if (topBtn) {
    topBtn.addEventListener("click", function () {
      var t = $("#news-controls");
      if (t) t.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
    window.addEventListener("scroll", syncTopButton, { passive: true });
  }

  var searchInput = $("#news-search");
  var searchTimer = null;
  if (searchInput) {
    // Debounced: render once per pause in typing, not per keystroke.
    searchInput.addEventListener("input", function () {
      var v = this.value;
      var clearBtn = $("#news-search-clear");
      if (clearBtn) clearBtn.hidden = !v;
      if (searchTimer) clearTimeout(searchTimer);
      var self = this;
      searchTimer = setTimeout(function () { applyQuery(v); }, 180);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.keyCode === 27) clearSearch();
    });
  }
  var searchClear = $("#news-search-clear");
  if (searchClear) searchClear.addEventListener("click", clearSearch);

  /* Re-run the spiral when the viewport changes shape — the arrangement is
     seeded, so the same names land in the same relative spots, just
     repacked for the new width. */
  var cloudResize = null;
  window.addEventListener("resize", function () {
    if (cloudResize) clearTimeout(cloudResize);
    cloudResize = setTimeout(cloudLayout, 150);
  });

  /* Hover and keyboard focus grow a name and make its neighbours yield;
     leaving (or blurring) springs everything home. One delegated listener
     pair on the container — no per-button handlers to leak. */
  var cloudBox = $("#news-cloud-words");
  function cloudEntryFrom(node) {
    if (!cloudEntries) return null;
    while (node && node !== cloudBox) {
      if (node.getAttribute && node.getAttribute("data-word")) {
        for (var i = 0; i < cloudEntries.length; i++)
          if (cloudEntries[i].btn === node) return cloudEntries[i];
        return null;
      }
      node = node.parentNode;
    }
    return null;
  }
  if (cloudBox) {
    cloudBox.addEventListener("mouseover", function (ev) {
      var e = cloudEntryFrom(ev.target);
      if (e) cloudGrow(e);
    });
    cloudBox.addEventListener("mouseout", function (ev) {
      // Moving between names hands growth over via mouseover; only leaving
      // the cloud entirely rests it.
      if (!ev.relatedTarget || !cloudBox.contains(ev.relatedTarget)) cloudRest();
    });
    cloudBox.addEventListener("focusin", function (ev) {
      var e = cloudEntryFrom(ev.target);
      if (e) cloudGrow(e);
    });
    cloudBox.addEventListener("focusout", function (ev) {
      if (!ev.relatedTarget || !cloudBox.contains(ev.relatedTarget)) cloudRest();
    });
  }

  var cloudToggle = $("#news-cloud-toggle");
  if (cloudToggle) {
    cloudToggle.addEventListener("click", function () {
      cloudSetOpen(!cloudIsOpen());
    });
  }

  var moreBtn = $("#news-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      state.shown += BUDGET;
      render();
    });
  }

  /* Deep links from the homepage strip (#story-… / #day-…) may point past
     the story budget — expand the window until the target exists (or
     everything is rendered), then pop its accordion open so the reader
     arrives at the whole entry. Runs after each render and on hash changes. */
  function settleTarget() {
    if (!location.hash) return;
    var id = location.hash.slice(1);
    var guard = 40;
    while (!document.getElementById(id) && state.shown < totalMatching() && guard-- > 0) {
      state.shown += BUDGET;
      render();
    }
    var t = document.getElementById(id);
    if (!t) return;
    var d = t.tagName === "DETAILS" ? t : t.querySelector("details");
    if (d) d.open = true;
    // Anchor the jump controls to the landed day, so ‹ › walk from there.
    var m = /^day-(\d{4}-\d{2}-\d{2})$/.exec(id) || /^story-(\d{4}-\d{2}-\d{2})-/.exec(id);
    if (m) {
      state.jumpDay = m[1];
      syncJumpControls();
    }
  }
  window.addEventListener("hashchange", settleTarget);

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
        state.shown = BUDGET;
        recomputeCounts();
        renderCounts();
        buildCloud(); // the cloud is whole-archive, so it builds once per load
        var controls = $("#news-controls");
        if (controls) controls.hidden = false;
        render();
        settleTarget();
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
