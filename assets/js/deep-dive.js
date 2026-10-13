/* ==========================================================================
   Sorklin Group — Deep-dive article viewer (/news/deep-dive/?s=<slug>)
   --------------------------------------------------------------------------
   Deep dives are long-form research pieces that are too big for the feed's
   expandable cards. Their full text lives in /news/deep-dives.json (an
   append-only library written by the same process that writes the daily
   feed); the feed's card links here with ?s=<slug>, and this page renders
   the matching entry.

   Same house rules as the feed renderer:
   1. Everything from the data file enters the DOM via textContent and
      attribute assignment — never innerHTML.
   2. Publisher links always open in a new tab (target=_blank +
      rel=noopener noreferrer), set in sourceLink().
   Guarded throughout: an unknown slug, missing file or bad shape renders a
   readable error state with a way back, never a blank page.
   ========================================================================== */
(function () {
  "use strict";

  var content = document.getElementById("dd-content");
  if (!content) return;

  var PAGE = {
    title: document.getElementById("dd-title"),
    kicker: document.getElementById("dd-kicker"),
    tldr: document.getElementById("dd-tldr"),
    tldrText: document.getElementById("dd-tldr-text"),
    summary: document.getElementById("dd-summary"),
    backRow: document.getElementById("dd-back-row"),
    bodySec: document.getElementById("dd-body-sec")
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch (e) { /* ancient engine: raw ISO dates still render */ }

  function catLabel(c) {
    return c === "ai" ? "AI Security" : c === "security" ? "Security" : "News";
  }

  /* The house rule: publisher links ALWAYS open in a new tab/window. */
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

  function errorState(title, body) {
    content.textContent = "";
    var box = el("div", "news-state");
    box.appendChild(el("h3", null, title));
    box.appendChild(el("p", null, body));
    var back = el("a", "btn btn-ghost", "Back to the Daily Brief");
    back.href = "/news/";
    box.appendChild(back);
    content.appendChild(box);
  }

  function render(dive) {
    if (PAGE.title) {
      PAGE.title.textContent = dive.title;
      document.title = dive.title + " — The Sorklin Group";
    }
    if (PAGE.kicker) {
      var bits = ["Deep dive"];
      if (dive.category) bits.push(catLabel(dive.category));
      var d = parseDay(dive.date);
      bits.push(d && fmt ? fmt.format(d) : dive.date);
      PAGE.kicker.textContent = bits.join(" · ");
    }
    if (PAGE.tldr && dive.tldr) {
      PAGE.tldr.hidden = false;
      if (PAGE.tldrText) PAGE.tldrText.textContent = dive.tldr;
    }
    if (PAGE.summary && dive.summary) {
      PAGE.summary.hidden = false;
      PAGE.summary.textContent = dive.summary;
    }
    if (PAGE.backRow) PAGE.backRow.hidden = false;
    if (PAGE.bodySec) PAGE.bodySec.hidden = false;

    var hasFacts = Array.isArray(dive.details) && dive.details.length;
    var hasSources = Array.isArray(dive.links) && dive.links.length;

    if (hasFacts) {
      var factsPanel = el("div", "panel ink dd-block");
      factsPanel.appendChild(el("div", "news-sub", "Key facts"));
      var facts = el("ul", "dashes dd-facts");
      for (var i = 0; i < dive.details.length; i++) facts.appendChild(el("li", null, dive.details[i]));
      factsPanel.appendChild(facts);
      content.appendChild(factsPanel);
    }

    if (hasSources) {
      var srcWrap = el("div", "dd-block");
      srcWrap.appendChild(el("div", "news-sub", "Sources — every link opens in a new tab"));
      var sources = el("ul", "news-links dd-sources");
      for (var s = 0; s < dive.links.length; s++) {
        var li = el("li");
        li.appendChild(sourceLink(dive.links[s]));
        sources.appendChild(li);
      }
      srcWrap.appendChild(sources);
      content.appendChild(srcWrap);
    }

    var note = el("div", "callout");
    note.appendChild(el("span", "ico", "[!]"));
    var noteBody = el("div");
    noteBody.appendChild(document.createTextNode(
      "Researched and compiled by an unattended process; confidence tiers (" +
      "CONFIRMED / REPORTED / UNVERIFIED) are preserved exactly as filed. "
    ));
    var em = el("span", null, "Linked articles are third-party content — their facts, their typos, their blame.");
    noteBody.appendChild(em);
    note.appendChild(noteBody);
    content.appendChild(note);
  }

  var slug = "";
  try {
    slug = (new URLSearchParams(location.search)).get("s") || "";
  } catch (e) { /* very old engine: no query parsing, error state explains */ }

  if (!slug) {
    errorState("No deep dive requested",
      "This page renders one deep dive at a time — open a card from the Daily Brief, or add ?s=<slug> to the address.");
  } else {
    content.textContent = "";
    content.appendChild(el("p", "dim mono news-loading", "Loading the deep dive…"));
    fetch("/news/deep-dives.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var dives = data && Array.isArray(data.dives) ? data.dives : [];
        var dive = null;
        for (var i = 0; i < dives.length; i++) {
          if (dives[i] && dives[i].slug === slug) { dive = dives[i]; break; }
        }
        if (!dive || typeof dive.title !== "string" || !dive.title.trim()) {
          throw new Error("no deep dive with slug \"" + slug + "\"");
        }
        render({
          title: String(dive.title),
          date: String(dive.date || ""),
          category: dive.category,
          tldr: String(dive.tldr || "").trim(),
          summary: String(dive.summary || "").trim(),
          details: Array.isArray(dive.details) ? dive.details : [],
          links: Array.isArray(dive.links) ? dive.links : []
        });
      })
      .catch(function (err) {
        errorState("Couldn't load that deep dive",
          "The library didn't load, or nothing is filed under \u201c" + slug +
          "\u201d (" + (err && err.message ? err.message : "unknown error") + "). " +
          "Check the Daily Brief for the current cards.");
      });
  }
})();
