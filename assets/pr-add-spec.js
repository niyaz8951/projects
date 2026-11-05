/* Projects tile - Add a specification. The old tools/projects/add-spec.html script, brought over 2026-11-05 and adapted to
   the DAME core through pr-hub.js: the project comes from the link (?project=<id>), the choice of product and factory is
   not kept in the browser, the classic converter link is gone, and the "which product is this specification about"
   check (the old server's lib/product-detect.ts) runs here in the browser before anything is saved (PRProductDetect,
   at the end of this file), asking the person in the same sheet as before. No AI. */
(function () {
  "use strict";
  var el = Hub.el, $ = function (id) { return document.getElementById(id); };
  var projectId = Hub.param("project"), project = null, products = [], notes = [], source = "pdf", file = null, busy = false;
  var sheetFac = {};       // product id -> { id, name } of the factory the project's datasheet names (Material Name)
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/projects/vendor/pdfjs/pdf.worker.min.js";

  function option(v, t) { return el("option", { value: v, text: t }); }
  function product() { return products.filter(function (p) { return p.id === $("as-product").value; })[0] || null; }
  function fillFactories(want) {
    var p = product(), s = $("as-factory");
    s.textContent = ""; s.appendChild(option("", p ? "Choose a factory" : "Choose a product first"));
    (p ? p.factories : []).forEach(function (f) { s.appendChild(option(f.id, f.name)); });
    s.disabled = !p;
    if (p && p.factories.length === 1) s.value = p.factories[0].id;
    else if (want) { s.value = want; if (s.value !== want) s.value = ""; }
  }
  function remember() { /* the choice is not kept in the browser: the project's datasheet decides the factory */ }
  function recall() { return {}; }

  function ready() { return !!$("as-factory").value && (source === "pdf" ? !!file : $("as-paste").value.trim().length > 0); }
  function refresh() {
    $("as-go").disabled = busy || !ready();
    $("as-go").textContent = busy ? "Working…" : "Convert and start filling";
  }
  function fail(text) { var m = $("as-msg"); m.textContent = text || ""; m.hidden = !text; }

  /* The factory the project's newest datasheet of this product names: saved with the table since 19 Oct 2026;
     an older table is opened once and its General > Factory row read. */
  function datasheetFactory(p) {
    if (!p) return Promise.resolve(null);
    if (sheetFac[p.id] !== undefined) return Promise.resolve(sheetFac[p.id]);
    var mine = notes.filter(function (n) { return n.product_id === p.id; });      // newest first
    if (!mine.length) { sheetFac[p.id] = null; return Promise.resolve(null); }
    var byId = function (id) { return p.factories.filter(function (f) { return f.id === id; })[0] || null; };
    var byName = function (name) { return p.factories.filter(function (f) { return f.name.toLowerCase() === String(name || "").toLowerCase(); })[0] || null; };
    if (mine[0].factory_id) { sheetFac[p.id] = byId(mine[0].factory_id); return Promise.resolve(sheetFac[p.id]); }
    return Api.prNoteGet(Hub.token(), mine[0].id).then(function (t) {
      var sec = "", name = "";
      (t.rows || []).forEach(function (r) { if (r.section) sec = r.section; if (!name && /^general$/i.test(sec) && /^factory$/i.test(r.component || "")) name = (r.cells || []).filter(function (v) { return v && v !== "-"; })[0] || ""; });
      sheetFac[p.id] = byName(name); return sheetFac[p.id];
    }, function () { sheetFac[p.id] = null; return null; });
  }
  /* Pre-select the datasheet's factory, and say so; warn when another factory is chosen. */
  function checkFactory(preselect) {
    var p = product(), hint = $("as-fac-hint");
    return datasheetFactory(p).then(function (f) {
      if (p !== product()) return;
      hint.className = "hint"; hint.textContent = "Answers are kept separately for each factory.";
      if (!f) {                 // no datasheet of this product in the project yet: say what that means, once
        if (p) hint.textContent = "No datasheet of this product in the project yet. You can go on: the clauses get the closest values the factory offers (Product Options) and the working Excel lists what to select. If the units are selected, read the datasheet first. Answers are kept separately for each factory.";
        return;
      }
      if (preselect && !$("as-factory").value) { $("as-factory").value = f.id; remember(); refresh(); }
      var chosen = $("as-factory").value;
      if (chosen && chosen !== f.id) {
        hint.className = "notice warn";
        hint.textContent = "The project's datasheet is from the " + f.name + " factory (its Material Name). With another factory the library answers and Product Options are that factory's, and the datasheet values are not shown beside the clauses.";
      } else hint.textContent = "The project's datasheet is from the " + f.name + " factory, so " + f.name + " is chosen. Answers are kept separately for each factory.";
    });
  }
  $("as-product").addEventListener("change", function () { fillFactories(); remember(); refresh(); checkFactory(true); });
  $("as-factory").addEventListener("change", function () { remember(); refresh(); checkFactory(false); });
  $("as-paste").addEventListener("input", refresh);

  [].forEach.call(document.querySelectorAll(".tab"), function (tab) {
    tab.addEventListener("click", function () {
      source = tab.getAttribute("data-src");
      [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      $("as-pdf").hidden = source !== "pdf"; $("as-text").hidden = source !== "text";
      fail(""); refresh();
    });
  });

  /* ---------- the file ---------- */
  function take(f) {
    fail("");
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { fail(f.name + " is not a PDF. Choose the specification as a PDF, or paste its text."); return; }
    if (f.size > 60 * 1024 * 1024) { fail(f.name + " is larger than 60 MB. Split it, or paste the text of the section you need."); return; }
    file = f; $("as-name").textContent = f.name; $("as-chosen").hidden = false; $("as-drop").hidden = true; refresh();
  }
  var drop = $("as-drop"), input = $("as-file");
  drop.addEventListener("click", function () { if (!busy) input.click(); });
  $("as-other").addEventListener("click", function () { if (busy) return; file = null; $("as-chosen").hidden = true; drop.hidden = false; refresh(); input.click(); });
  input.addEventListener("change", function () { take(input.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && !busy) take(f); });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });      // a PDF dropped beside the box must not replace the page
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  /* ---------- convert, save in the project, open it for filling ---------- */
  function status(text) { $("as-status").textContent = text; }
  $("as-go").addEventListener("click", function () {
    if (busy || !ready()) return;
    busy = true; fail(""); $("as-busy").hidden = false; refresh();
    var skip = $("as-skip").checked, name = "", work;
    if (source === "pdf") { name = file.name; work = CMEngine.fromPdf(file, { skipFront: skip, onProgress: status }); }
    else {
      status("Sorting the clauses…");
      var raw = $("as-paste").value;
      if (window.TN && window.TN.reflow && window.TN.reflow.tidyForParsing) raw = window.TN.reflow.tidyForParsing(raw).text;   // page lines out, split words rejoined
      name = $("as-title").value.replace(/\s+/g, " ").trim();
      work = Promise.resolve(CMEngine.fromText(raw, { skipFront: skip }));
    }
    work.then(function (res) {
      var clauses = res.rows.filter(function (r) { return r.type === "letter" || r.type === "number" || r.type === "text"; }).length;
      if (!clauses) throw new Error("No clauses were found. Check that this is the specification text" + (skip ? ", or untick \"Skip the cover and contents pages\"" : "") + ".");
      status("Saving " + clauses + " clauses in " + project.name + "…");
      var lines = res.rows.map(function (r) { return { type: r.type || "", sr: r.sr || "", spec: r.spec || "" }; });
      function save() {
        return Api.cmSaveRun(Hub.token(), { factoryId: $("as-factory").value, source: source, fileName: name, projectId: projectId, lines: lines });
      }
      // which product the text is about is read here, before anything is saved; when it is clearly another one, the person decides (cm-product-check.js)
      var mismatch = PRProductDetect.mismatch(product(), products, lines);
      return (mismatch ? Promise.reject(mismatch) : save()).then(null, function (err) {
        if (!CMProductCheck.is(err)) throw err;
        return CMProductCheck.ask(err).then(function (choice) {
          if (choice === "keep") return save();
          if (choice === "switch") {
            $("as-product").value = err.data.detected.id; $("as-factory").value = "";
            fillFactories(); remember(); refresh(); checkFactory(true);
            throw new Error("Product changed to " + err.data.detected.name + ". Check the factory and press Convert and start filling again. Nothing was saved.");
          }
          throw new Error("Nothing was saved. Choose the right product and convert again.");
        });
      }).then(function (saved) {
        var go = function () { Core.go("/projects/record.html?run=" + encodeURIComponent(saved.run_id)); };
        var notes = (res.partial ? [res.partial] : []).concat(res.info || []);
        if (res.partial) Hub.tell(notes.join("\n"), { title: "Part of the specification was read" }).then(go);
        else { Hub.toast(clauses + " clauses added" + (saved.matched ? ", " + saved.matched + " filled from the library" : "") + "."); go(); }
      });
    }).then(null, function (err) {
      busy = false; $("as-busy").hidden = true; refresh();
      fail((err && err.message) || String(err));
    });
  });

  /* ---------- start ---------- */
  Hub.requireLogin({ right: "edit" }).then(function () {
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("No project was chosen. Open a project first, then add a specification.");
    return Promise.all([Api.prGet(Hub.token(), projectId), Api.cmOptions(Hub.token())]);
  }).then(function (res) {
    project = res[0].project; products = res[1].products || []; notes = res[0].notes || [];
    Hub.setBack(project.code + " " + project.name, "/projects/project.html?id=" + encodeURIComponent(projectId));
    Core.setTitle("Add a specification - " + project.code);
    $("as-intro").textContent = "For " + project.code + " " + project.name + ". Choose the product and factory, give the specification, and start filling. Clauses answered before come filled in.";
    var last = recall(), s = $("as-product");
    s.textContent = ""; s.appendChild(option("", "Choose a product"));
    products.forEach(function (p) { s.appendChild(option(p.id, p.name)); });
    s.disabled = false;
    if (products.length === 1) s.value = products[0].id; else if (last.p) { s.value = last.p; if (s.value !== last.p) s.value = ""; }
    // the product of the project's newest datasheet comes pre-selected, as its factory does
    if (!s.value && notes.length && products.some(function (x) { return x.id === notes[0].product_id; })) s.value = notes[0].product_id;
    fillFactories(last.f);
    $("as-form").hidden = false; refresh();
    // the datasheet's factory wins over the last choice when the project has a datasheet of this product
    datasheetFactory(product()).then(function (f) { if (f && $("as-factory").value !== f.id) { $("as-factory").value = f.id; remember(); refresh(); } checkFactory(false); });
  }, function (err) {
    $("as-error").hidden = false; $("as-error").textContent = ((err && err.message) || err) + "";
    document.documentElement.removeAttribute("data-loading");
  });
})();

/* ============================================================
   Which product a specification is about (the old worker/src/lib/product-detect.ts, in the browser). The product's own name
   counted three times in headings and the title lines, the MasterFormat section number, a little weight for parts only
   that product has. "Another product" only when it clearly dominates. */
(function () {
  "use strict";
  var KEYS = ["AHU", "FCU", "CHILLER"];
  function productKey(product) {
    var p = String(product || "").toUpperCase();
    return /AHU|AIR[\s-]*HANDL/.test(p) ? "AHU" : /FCU|FAN[\s-]*COIL/.test(p) ? "FCU" : /CHILL/.test(p) ? "CHILLER" : "";
  }
  var STRONG = {
    AHU: [{ re: /\bair[\s-]*handling[\s-]*units?\b/gi, label: "air handling unit" }, { re: /\b(?:F|D|R|P)?AHUs?\b/g, label: "AHU" }, { re: /\bair[\s-]*handlers?\b/gi, label: "air handler" }, { re: /\b23\s?7[34]\s?\d\d\b/g, label: "section 23 73 / 23 74" }],
    FCU: [{ re: /\bfan[\s-]*coil(?:[\s-]*units?)?s?\b/gi, label: "fan coil unit" }, { re: /\bFCUs?\b/g, label: "FCU" }, { re: /\b23\s?82\s?19\b/g, label: "section 23 82 19" }],
    CHILLER: [{ re: /\bchillers?\b/gi, label: "chiller" }, { re: /\b(?:water|liquid)[\s-]*chilling\b/gi, label: "water chilling package" }, { re: /\b23\s?64\s?\d\d\b/g, label: "section 23 64" }]
  };
  var WEAK = {
    AHU: /\b(EN\s?1886|EN\s?13053|casing leakage|thermal bridging|heat wheel|thermal wheel|plug fans?|mixing box(?:es)?|central[\s-]station)\b/gi,
    FCU: /\b(valve packages?|[24][\s-]pipe|room thermostats?|PICV|auxiliary drain pan|ceiling void)\b/gi,
    CHILLER: /\b(compressors?|evaporators?|condensers?|refrigerant circuits?|IPLV|NPLV|kW\/TR|crankcase heaters?)\b/gi
  };
  var HEADING = { part: 1, section: 1, heading: 1, sub: 1, title: 1 };
  var NAMES = { AHU: "air handling unit", FCU: "fan coil unit", CHILLER: "chiller" };
  function detect(lines) {
    var scores = { AHU: 0, FCU: 0, CHILLER: 0 }, hits = { AHU: {}, FCU: {}, CHILLER: {} };
    lines.slice(0, 8000).forEach(function (ln, i) {
      var text = String(ln.spec || ""); if (!text) return;
      var w = HEADING[String(ln.type || "")] || i < 40 ? 3 : 1;
      KEYS.forEach(function (k) {
        STRONG[k].forEach(function (c) { var n = (text.match(c.re) || []).length; if (n) { scores[k] += n * w; hits[k][c.label] = (hits[k][c.label] || 0) + n; } });
        scores[k] += (text.match(WEAK[k]) || []).length * 0.3;
      });
    });
    var named = {};
    KEYS.forEach(function (k) { named[k] = Object.keys(hits[k]).sort(function (a, b) { return hits[k][b] - hits[k][a]; }).map(function (l) { return "\"" + l + "\" " + hits[k][l] + "x"; }); });
    var order = KEYS.slice().sort(function (a, b) { return scores[b] - scores[a]; }), top = order[0], second = order[1];
    var clear = scores[top] >= 6 && scores[top] >= 4 * scores[second];
    return { key: clear ? top : "", scores: scores, named: named };
  }
  /* The error the page shows in the same sheet the old server's PRODUCT_MISMATCH refusal got, or null. */
  function mismatch(chosenProduct, products, lines) {
    if (!chosenProduct) return null;
    var chosen = productKey(chosenProduct.name);
    if (!chosen) return null;
    var d = detect(lines);
    if (!d.key || d.key === chosen || d.scores[chosen] * 4 > d.scores[d.key]) return null;
    var theirs = d.named[d.key].slice(0, 3).join(", "), mine = d.named[chosen].length ? d.named[chosen].slice(0, 2).join(", ") : "never";
    var other = (products || []).filter(function (x) { return productKey(x.name) === d.key; })[0] || null;
    var reason = "It reads as " + (/^[aeiou]/.test(NAMES[d.key]) ? "an" : "a") + " " + NAMES[d.key] + " specification: it names " + theirs + "; " + NAMES[chosen] + " " + (d.named[chosen].length ? "only " + mine : "is never named") + ".";
    var article = other ? (/^[aeiou]/i.test(other.name) || /^[FHLMNRSX][A-Z0-9]/.test(other.name) ? "an " : "a ") + other.name : "another product's";
    return { code: "PRODUCT_MISMATCH", message: "This looks like " + article + " specification, not " + chosenProduct.name + ". " + reason + " Saved under " + chosenProduct.name + ", its clauses would go into the " + chosenProduct.name + " library and get " + chosenProduct.name + " answers.",
             data: { chosen: { id: chosenProduct.id, name: chosenProduct.name }, detected: other, reason: reason } };
  }
  window.PRProductDetect = { detect: detect, mismatch: mismatch, productKey: productKey };
})();
