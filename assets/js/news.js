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
    render();
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
