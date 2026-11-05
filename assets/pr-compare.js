/* Projects tile - Specification beside datasheet: what the specification asks for, next to what each unit has, row by row.
   The old tools/projects/compare.html script, brought over 2026-11-05 and adapted to the DAME core through pr-hub.js. */
(function () {
  "use strict";
  var el = Hub.el, $ = function (id) { return document.getElementById(id); };
  var projectId = Hub.param("project"), productId = Hub.param("product");
  var project = null, productName = "", columns = [], table = [], factory = "", narrow = window.matchMedia("(max-width: 640px)");

  function low(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
  var sec = PROptions.sectionName;

  function hasValue(r) { return PRMatch.hasValue(r); }

  function shown() {
    var q = low($("cp-q").value), only = $("cp-only").checked;
    return table.filter(function (r) {
      if (r.kind === "sub") return true;                             // dropped below when nothing follows it
      if (!r.found && !hasValue(r)) return false;                    // nothing on either side: not worth a line
      if (only && !r.found) return false;
      return !q || low(r.section + " " + r.component + " " + r.spec + " " + r.cells.join(" ")).indexOf(q) >= 0;
    });
  }

  function draw() {
    var rows = shown(), unitW = columns.length > 6 ? 160 : 200, lead = narrow.matches ? [130, 260] : [220, 420];
    var cols = $("cp-cols"), head = $("cp-head-row"); cols.textContent = ""; head.textContent = "";
    lead.concat(columns.map(function () { return unitW; })).forEach(function (w) { cols.appendChild(el("col", { style: "width:" + w + "px" })); });
    ["Section / component", "Specification asks"].concat(columns).forEach(function (t, i) { head.appendChild(el("th", { text: t, "class": i >= 2 ? "unit" : null })); });
    $("cp-table").style.minWidth = (lead[0] + lead[1] + unitW * columns.length) + "px";

    var frag = document.createDocumentFragment(), secName = null, sub = null, n = 0;
    rows.forEach(function (r) {
      if (r.kind === "sub") { sub = r; return; }
      if (r.section !== secName) { secName = r.section; sub = sub && sub.section === r.section ? sub : null; frag.appendChild(el("tr", { "class": "sec" }, [el("td", { colspan: String(2 + columns.length), text: r.section })])); }
      if (sub && sub.section === r.section) { frag.appendChild(el("tr", { "class": "sub" }, [el("td", { colspan: String(2 + columns.length), text: sub.component })])); }
      sub = null;
      var name = el("button", { type: "button", "class": "cp-row", text: r.component, title: "What the factory offers for this row", onclick: function () {
        PROptions.open({ productId: productId, product: productName, factory: factory, key: r.key, section: r.section, component: r.component, values: r.cells });
      } });
      frag.appendChild(el("tr", {}, [el("td", { "class": "comp" }, [name]), el("td", { "class": "spec" + (r.spec ? "" : " none"), text: r.spec || "Not found in the specification" })]
        .concat(r.cells.map(function (v) { return el("td", { "class": "val" + (v && v !== "-" ? "" : " none"), text: v || "-" }); }))));
      n++;
    });
    $("cp-body").textContent = ""; $("cp-body").appendChild(frag);
    $("cp-wrap").hidden = !n; $("cp-empty").hidden = !!n;
    var all = table.filter(function (r) { return r.kind === "row"; }), asked = all.filter(function (r) { return r.found; }).length, both = all.filter(function (r) { return r.found && hasValue(r); }).length;
    $("cp-count").textContent = asked + " rows the specification asks about, " + both + " of them with a datasheet value. " + n + " shown.";
  }
  var timer;
  $("cp-q").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(draw, 200); });
  $("cp-only").addEventListener("change", draw);
  if (narrow.addEventListener) narrow.addEventListener("change", function () { if (table.length) draw(); });

  $("cp-download").addEventListener("click", function () {
    var rows = [["Section", "Component", "Specification asks"].concat(columns, ["Remarks"])], secRows = [], last = null;
    shown().forEach(function (r) {
      if (r.kind === "sub") return;
      if (r.section !== last) { last = r.section; secRows.push(rows.length); rows.push([r.section, "", ""].concat(columns.map(function () { return ""; }), [""])); }
      rows.push(["", r.component, r.spec].concat(r.cells.map(function (v) { return v || "-"; }), [""]));
    });
    PRXlsx.save(PRXlsx.build([{ name: "Spec vs datasheet", widths: [24, 30, 70].concat(columns.map(function () { return 26; }), [30]), rows: rows, sect: secRows }]),
      project.name + " - " + productName + " - specification and datasheet.xlsx");
    Hub.toast("Excel downloaded.");
  });

  Hub.requireLogin({}).then(function () {
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId) || !productId) throw new Error("No project or product was chosen.");
    return Api.prGet(Hub.token(), projectId);
  }).then(function (res) {
    project = res.project;
    Hub.setBack(project.code + " " + project.name, "/projects/project.html?id=" + encodeURIComponent(projectId));
    return PRMatch.load({ projectId: projectId, productId: productId, detail: res }).then(function (m) {
      productName = m.product;
      if (!m.runs.length || !m.notes.length) throw new Error("This needs a specification and a datasheet of the same product in the project. " + (!m.runs.length ? "Add the " + productName + " specification first." : "Read the " + productName + " datasheet first."));
      columns = m.columns; table = m.table; factory = m.factory;
      Core.setTitle(productName + ": specification and datasheet - " + project.code);
      $("cp-title").textContent = productName + ": specification and datasheet";
      var facts = $("cp-facts");
      [project.name, m.runs.length + (m.runs.length === 1 ? " specification" : " specifications"), columns.length + (columns.length === 1 ? " unit" : " units"), factory ? factory + " factory" : ""]
        .filter(Boolean).forEach(function (x) { facts.appendChild(el("span", { "class": "badge", text: x })); });
      var found = table.filter(function (r) { return r.found; }).length;
      if (!m.keyed) { $("cp-note").hidden = false; $("cp-note").textContent = "No row of the " + productName + " mapping has keywords yet, so no requirement can be found. An editor adds them in Product Options > Row mapping."; }
      $("cp-only").checked = found > 0; $("cp-only").disabled = !found;
      $("cp-loading").hidden = true; $("cp-main").hidden = false;
      draw();
    });
  }).then(null, function (err) {
    $("cp-loading").hidden = true; $("cp-error").hidden = false;
    $("cp-error").textContent = ((err && err.message) || err) + " Go back to the project.";
    document.documentElement.removeAttribute("data-loading");
  });
})();