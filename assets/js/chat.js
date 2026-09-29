/* ==========================================================================
   SorkGPT — front-end for models served on Spark-I-Tron 6000
   --------------------------------------------------------------------------
   STATUS: STUB. The interface is finished; the wire is not.

   What already works: sessions, streaming render, an OpenAI-compatible
   client (/v1/chat/completions with SSE), settings persistence, a demo mode
   so the page is honest about being un-connected.

   What is deliberately NOT here yet (see README → TODO):
     • auth. When this becomes family-only, access control belongs on a server
       in front of Spark-I-Tron 6000 — NOT in this file. Anything a browser can send,
       a curious twelve-year-old can read.
     • a CORS-reachable endpoint. A raw model host will refuse cross-origin
       calls from www.sorklin.com; put a small proxy in front of it and point
       "Base URL" at the proxy.
   ========================================================================== */
(function () {
  "use strict";

  var CFG_KEY = "sorklin.spark.config";
  var SESSIONS_KEY = "sorklin.spark.sessions";

  var DEFAULTS = {
    baseUrl: "",                       // e.g. https://spark-i-tron-6000.lan/proxy — blank until wired up
    apiKey: "",
    model: "spark-i-tron-6000",               // free-text; also editable in settings
    effort: "medium",
    temperature: 0.7,
    system: "You are SorkGPT, a concise assistant running on The Sorklin Group's own hardware, on Spark-I-Tron 6000."
  };

  /* Models advertised in the picker. Spark-I-Tron 6000 serves what it serves — edit
     this list (or just type a name into the box; it is free text on purpose). */
  var MODEL_HINTS = ["spark-i-tron-6000", "qwen3.8-flash", "deepseek-v4-flash-vision", "glm-5.3-flash", "nemotron-3.5-lightning"];

  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  function load(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  var cfg = Object.assign({}, DEFAULTS, load(CFG_KEY, {}));
  var sessions = load(SESSIONS_KEY, []);
  var current = sessions[0] || newSession(true);
  var controller = null;

  function persist() { save(SESSIONS_KEY, sessions); }

  function newSession(silent) {
    var s = { id: uid(), title: "New conversation", created: Date.now(), messages: [] };
    sessions.unshift(s);
    if (!silent) { current = s; renderSidebar(); renderThread(); persist(); $("#input").focus(); }
    return s;
  }

  /* ------------------------------------------------------- markdown-lite -- */
  function render(md) {
    var src = esc(md);
    var blocks = [];
    // pull fenced code out first so nothing inside it gets mangled
    src = src.replace(/```([\w-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      blocks.push("<pre><code>" + code.replace(/\n$/, "") + "</code></pre>");
      return "\u00A7CODE" + (blocks.length - 1) + "\u00A7";
    });
    src = src
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^[-*] (.*)$/gm, "• $1");
    var html = src.split(/\n{2,}/).map(function (para) {
      var t = para.trim();
      if (!t) return "";
      var held = t.match(/^\u00A7CODE(\d+)\u00A7$/);
      if (held) return blocks[+held[1]];
      if (/^<(h4|pre)/.test(t)) return t;
      if (/^(•|\d+\.)\s/.test(t)) return "<p>" + t.replace(/\n/g, "<br>") + "</p>";
      return "<p>" + t.replace(/\n/g, "<br>") + "</p>";
    }).join("");
    return html || "<p></p>";
  }

  /* ------------------------------------------------------------ sidebar -- */
  function renderSidebar() {
    var list = $(".sessions");
    list.innerHTML = "";
    if (!sessions.length) {
      list.appendChild(el("div", "empty", "Nothing yet. Start one."));
      return;
    }
    sessions.forEach(function (s) {
      var row = el("button", "session" + (s.id === current.id ? " active" : ""));
      row.appendChild(el("span", "t", esc(s.title)));
      var del = el("span", "del", "×");
      del.title = "Delete this conversation";
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        sessions = sessions.filter(function (x) { return x.id !== s.id; });
        if (current.id === s.id) current = sessions[0] || newSession(true);
        persist(); renderSidebar(); renderThread();
      });
      row.appendChild(del);
      row.addEventListener("click", function () {
        current = s; renderSidebar(); renderThread();
      });
      list.appendChild(row);
    });
  }

  function endpointLabel() {
    return cfg.baseUrl ? cfg.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Spark-I-Tron 6000 · link down";
  }

  function renderEndpoint() {
    var chip = $(".endpoint-chip");
    chip.classList.toggle("on", !!cfg.baseUrl);
    chip.innerHTML = "<i></i><span>" + esc(endpointLabel()) + "</span>";
  }

  /* -------------------------------------------------------------- thread -- */
  function bubble(role, model) {
    var m = el("div", "msg " + role);
    var who = el("div", "who", role === "user" ? "you" : role === "demo" ? "!!" : "AI");
    var body = el("div", "body");
    var head = el("div", "head",
      "<span>" + (role === "user" ? "You" : role === "demo" ? "Simulated" : "SorkGPT") + "</span>" +
      (model ? "<span class='model'>" + esc(model) + "</span>" : ""));
    var text = el("div", "text");
    body.appendChild(head); body.appendChild(text);
    m.appendChild(who); m.appendChild(body);
    $(".thread-inner").appendChild(m);
    return { node: m, text: text };
  }

  function renderThread() {
    var inner = $(".thread-inner");
    inner.innerHTML = "";
    if (!current.messages.length) {
      inner.appendChild(el("div", "empty-state",
        "<h2>SorkGPT is awake. The wire is not.</h2>" +
        "<p>This is the front-end for the models on <b>spark-i-tron-6000</b>. The interface works; " +
        "the connection is the next piece of engineering. Until then, anything you send gets an " +
        "honest answer from the demo brain instead of a fake one from a model.</p>" +
        "<div class='suggests'>" +
        "<button>Explain a loss exceedance curve like I'm a board member</button>" +
        "<button>Difference between C2M2 and NIST CSF 2.0?</button>" +
        "<button>Name a D&D shopkeeper who overcharges and get away with it</button>" +
        "<button>Why self-host models at all?</button>" +
        "</div>"));
      inner.querySelectorAll(".suggests button").forEach(function (b) {
        b.addEventListener("click", function () { $("#input").value = b.textContent; send(); });
      });
      return;
    }
    current.messages.forEach(function (m) {
      var b = bubble(m.role === "user" ? "user" : (m.demo ? "demo" : "assistant"), m.model);
      b.text.innerHTML = render(m.content);
    });
    scrollDown();
  }

  function scrollDown() {
    var t = $(".thread");
    t.scrollTop = t.scrollHeight;
  }

  /* ------------------------------------------------------------ sending -- */
  function titleFrom(text) {
    var t = text.trim().replace(/\s+/g, " ");
    return t.length > 42 ? t.slice(0, 42) + "…" : t;
  }

  var DEMO_REPLIES = [
    "I'm the stub brain, not the real one. The interface you're looking at is finished — sessions, streaming, " +
      "settings, the lot. What's missing is the wire from this page to Spark-I-Tron 6000. " +
      "Open <b>Settings</b> and point <b>Base URL</b> at a CORS-reachable endpoint and I'll step aside for the actual model.",
    "Answer withheld: no model is connected yet. That's not shyness, it's architecture. " +
      "Put a small proxy in front of Spark-I-Tron 6000, allow this origin, and this message becomes a real answer.",
    "Hypothetical answer, clearly labelled: your question deserves a model, and there isn't one on the other end of this " +
      "page yet. The demo brain has opinions but no weights.",
    "Demo mode, honestly labelled. I can tell you three things about the real SorkGPT: it speaks the OpenAI-compatible " +
      "chat protocol, it lives on hardware I can unplug, and it's currently unreachable from a browser tab. " +
      "The third one is the only interesting problem."
  ];

  function send() {
    var input = $("#input");
    var text = input.value.trim();
    if (!text || controller) return;

    current.messages.push({ role: "user", content: text, ts: Date.now() });
    if (current.messages.length === 1) { current.title = titleFrom(text); }
    input.value = "";
    grow();
    renderThread();
    renderSidebar();
    persist();

    var out = bubble(cfg.baseUrl ? "assistant" : "demo", cfg.baseUrl ? cfg.model : "demo brain");
    out.text.innerHTML = "<span class='dots'><i></i><i></i><i></i></span>";
    scrollDown();
    setBusy(true);

    if (!cfg.baseUrl) return demoReply(out, text);
    realReply(out, text);
  }

  function demoReply(out, asked) {
    var reply = DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)];
    if (/^\s*(hi|hello|hey)\b/i.test(asked)) {
      reply = "Hello from a page with no backend. Everything on this screen is real except the intelligence — " +
        "that's the part still being built. <b>Settings</b> has the two fields that would change everything.";
    }
    var i = 0;
    controller = { abort: function () { i = reply.length; } };
    var chunk = function () {
      if (i >= reply.length) {
        current.messages.push({ role: "assistant", content: reply, ts: Date.now(), demo: true, model: "demo brain" });
        persist();
        finish(out, reply);
        return;
      }
      i = Math.min(reply.length, i + 3 + Math.floor(Math.random() * 6));
      out.text.innerHTML = render(reply.slice(0, i));
      scrollDown();
      setTimeout(chunk, 16);
    };
    setTimeout(chunk, 420);
  }

  function realReply(out, text) {
    var payload = {
      model: cfg.model,
      temperature: Number(cfg.temperature),
      stream: true,
      messages: (cfg.system ? [{ role: "system", content: cfg.system }] : [])
        .concat(current.messages.filter(function (m) { return !m.demo; }).map(function (m) {
          return { role: m.role, content: m.content };
        }))
    };
    var headers = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers.Authorization = "Bearer " + cfg.apiKey;

    controller = new AbortController();
    var acc = "";
    fetch(cfg.baseUrl.replace(/\/$/, "") + "/v1/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error("HTTP " + res.status + " — " + t.slice(0, 240)); });
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      var pump = function () {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (!line.startsWith("data:")) return;
            var data = line.slice(5).trim();
            if (data === "[DONE]") return;
            try {
              var j = JSON.parse(data);
              var bit = (j.choices && j.choices[0] &&
                ((j.choices[0].delta && j.choices[0].delta.content) || (j.choices[0].message && j.choices[0].message.content))) || "";
              if (bit) {
                acc += bit;
                out.text.innerHTML = render(acc);
                scrollDown();
              }
            } catch (e) { /* partial frame — ignore */ }
          });
          return pump();
        });
      };
      return pump();
    }).then(function () {
      current.messages.push({ role: "assistant", content: acc || "(empty response)", ts: Date.now(), model: cfg.model });
      persist();
      finish(out, acc);
    }).catch(function (err) {
      var name = err && err.name;
      var msg = name === "AbortError"
        ? "Stopped."
        : "Couldn't reach the model.\n\n`" + esc(String(err && err.message || err)) + "`\n\n" +
          "Most likely one of: the endpoint isn't reachable from this origin (CORS), the base URL needs `/v1` " +
          "or doesn't, or the key is wrong. The browser console has the details.";
      out.text.innerHTML = render(msg);
      out.node.classList.add("demo");
      controller = null;
      setBusy(false);
    });
  }

  function finish(out, text) {
    controller = null;
    setBusy(false);
    if (text) {
      var acts = el("div", "acts");
      var copy = el("button", null, "copy");
      copy.addEventListener("click", function () {
        if (navigator.clipboard) navigator.clipboard.writeText(text);
        copy.textContent = "copied";
        setTimeout(function () { copy.textContent = "copy"; }, 1400);
      });
      acts.appendChild(copy);
      out.node.querySelector(".body").appendChild(acts);
    }
    scrollDown();
  }

  function setBusy(on) {
    var btn = $("#send");
    btn.disabled = on;
    btn.innerHTML = on ? "Stop" : 'Send <span class="arrow">↑</span>';
  }

  /* ----------------------------------------------------------- composer -- */
  function grow() {
    var t = $("#input");
    t.style.height = "auto";
    t.style.height = Math.min(240, t.scrollHeight) + "px";
  }

  $("#input").addEventListener("input", grow);
  $("#input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("#send").addEventListener("click", function () {
    if (controller) {
      if (controller.abort) controller.abort();
      if (controller.abort === undefined) { controller.abort = true; }
      return;
    }
    send();
  });

  /* ----------------------------------------------------------- settings -- */
  var drawer = $(".drawer"), scrim = $(".scrim");
  function openDrawer() {
    $("#cfg-url").value = cfg.baseUrl;
    $("#cfg-key").value = cfg.apiKey;
    $("#cfg-model").value = cfg.model;
    $("#cfg-temp").value = cfg.temperature;
    $("#cfg-system").value = cfg.system;
    drawer.classList.add("open"); scrim.classList.add("open");
  }
  function closeDrawer() { drawer.classList.remove("open"); scrim.classList.remove("open"); }

  // three separate triggers (nav link, banner button, sidebar link) open the same drawer
  Array.prototype.forEach.call(document.querySelectorAll(".open-settings"), function (b) {
    b.addEventListener("click", function (e) { e.preventDefault(); openDrawer(); });
  });
  $(".drawer .close").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  $("#cfg-save").addEventListener("click", function () {
    cfg.baseUrl = $("#cfg-url").value.trim();
    cfg.apiKey = $("#cfg-key").value.trim();
    cfg.model = $("#cfg-model").value.trim() || DEFAULTS.model;
    cfg.temperature = $("#cfg-temp").value || 0.7;
    cfg.system = $("#cfg-system").value;
    save(CFG_KEY, cfg);
    renderEndpoint();
    $("#cfg-model-chip").textContent = cfg.model;
    closeDrawer();
  });

  $("#cfg-test").addEventListener("click", function () {
    var url = $("#cfg-url").value.trim().replace(/\/$/, "");
    var out = $("#cfg-result");
    if (!url) { out.textContent = "No base URL yet — that's the whole missing piece."; return; }
    out.textContent = "Probing " + url + "/v1/models …";
    var h = {};
    if (cfg.apiKey) h.Authorization = "Bearer " + cfg.apiKey;
    fetch(url + "/v1/models", { headers: h })
      .then(function (r) { return r.text().then(function (t) { out.textContent = "HTTP " + r.status + " — " + t.slice(0, 300); }); })
      .catch(function (e) { out.textContent = "Failed: " + e.message + " — usually CORS or DNS."; });
  });

  $("#wipe").addEventListener("click", function () {
    if (!confirm("Delete every local conversation? Nothing was ever sent anywhere, so this only costs you your own notes.")) return;
    sessions = []; save(SESSIONS_KEY, sessions);
    current = newSession(true);
    renderSidebar(); renderThread();
  });

  /* --------------------------------------------------------------- boot -- */
  var chips = $("#model-hints");
  MODEL_HINTS.forEach(function (m) { var o = document.createElement("option"); o.value = m; chips.appendChild(o); });
  $("#cfg-model-chip").textContent = cfg.model;
  setBusy(false);
  renderEndpoint();
  renderSidebar();
  renderThread();

  $(".new-chat").addEventListener("click", function () { newSession(); });
})();
