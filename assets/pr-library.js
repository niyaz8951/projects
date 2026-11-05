/* Projects tile - Compliance review: the factory compliance library for the reviewers (right 'review'). The old
   tools/compliance-maker/library.html script, brought over 2026-11-05 and adapted to the DAME core through pr-hub.js.
   Left out (no AI, maps in another tile): the AI rules tab with its maps, Try a clause and Check the AI. Changed: the
   product check of an upload runs in the browser (PRProductDetect); the sample upload file is built here with invented
   clauses; a link may name the factory and a project code (?factory=&code=). */
(function () {
  "use strict";
  // the answers (Matching rules > Answers, 014): picked, never typed
  var LIB_CHOICES = ["Comply", "Comply with Remarks", "Noted", "Not Comply", "Not Applicable", "In Contractor's Scope"];
  Hub.answerChoices().then(function (c) { LIB_CHOICES = c; [].forEach.call(document.querySelectorAll("select.answer-pick"), function (s) { if (s.setChoices) s.setChoices(c); }); });
  var $ = function (id) { return document.getElementById(id); };
  var el = Hub.el, PAGE = 100;
  var products = [], offset = 0, total = 0, pending = null, searchTimer, shownLines = [], editing = false;

  function fail(err) { Hub.toast(err && err.message ? err.message : String(err), true); }
  function factoryId() { return $("factory").value; }
  function scopeName() {
    var p = products.filter(function (x) { return x.id === $("product").value; })[0];
    var f = p && p.factories.filter(function (x) { return x.id === factoryId(); })[0];
    return p && f ? p.name + " / " + f.name : "";
  }
  function fmt(iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d) ? "" : Hub.date(iso, true); }

  // ---------- scope ----------
  function fillFactories() {
    var p = products.filter(function (x) { return x.id === $("product").value; })[0], s = $("factory");
    s.textContent = ""; s.appendChild(el("option", { value: "", text: p ? "Choose a factory" : "Choose a product first" }));
    (p ? p.factories : []).forEach(function (f) { s.appendChild(el("option", { value: f.id, text: f.name })); });
    s.disabled = !p;
  }
  // on a phone, Focus mode sits at the bottom once there are lines to read (Lines tab)
  function libDock() {
    var on = !!factoryId() && !$("tab-lines").hidden;
    Hub.dock(on ? [el("button", { type: "button", "class": "btn", text: "Focus mode", onclick: function () { $("btnFocus").click(); } })] : []);
  }
  function scopeChanged() {
    var on = !!factoryId(); setTimeout(libDock, 0);
    $("work").hidden = !on; $("stats").hidden = !on;
    $("upScope").textContent = scopeName();
    resetUpload();
    $("fPart").value = ""; $("fTopic").value = ""; $("fClientType").value = ""; $("fClient").value = ""; $("fCode").value = "";
    if (on) { offset = 0; loadLines.fresh = true; loadLines(); }
  }
  $("product").addEventListener("change", function () { fillFactories(); scopeChanged(); });
  $("factory").addEventListener("change", scopeChanged);

  // ---------- lines ----------
  function setCounts(c) {
    $("sAll").textContent = c.all; $("sOpen").textContent = c.open; $("sDone").textContent = c.answered; $("sReview").textContent = c.review || 0;
    $("sBar").style.width = (c.all ? Math.round(c.answered / c.all * 100) : 0) + "%";
  }
  /* In Edit a line is first drawn as text and gets its boxes when it comes near the window (Hub.lazyRows). */
  var lazy = Hub.lazyRows(function (tr) { return lineRow(tr._line, true); });
  function lineRow(l, boxes) {
    var comp = Hub.answerPick(l.compliance || "", LIB_CHOICES);
    var rem = el("textarea", { "class": "input", rows: "1", maxlength: "4000", "aria-label": "Remarks" }); rem.value = l.remarks || ""; Hub.autoGrow(rem);
    var note = el("textarea", { "class": "input", rows: "1", maxlength: "4000", "aria-label": "Internal Comments", placeholder: "Note for users  # for reviewers" }); note.value = l.comments || ""; Hub.autoGrow(note);
    // Enter in Compliance goes to the next line, so a run of answers is typed without the mouse
    comp.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var nx = row.nextElementSibling;
      while (nx && !(nx.classList.contains("line") && (nx._lazy || nx.querySelector("select.answer-pick")))) nx = nx.nextElementSibling;
      if (nx && nx._lazy) nx = lazy.now(nx);
      if (nx) nx.querySelector("select.answer-pick").focus(); else comp.blur();
    });
    var state = el("span", { "class": "state", "aria-live": "polite" });
    var saved = { c: l.compliance || "", r: l.remarks || "", n: l.comments || "" };
    var busy = null;                                    // one save at a time; resolves true when the answer is stored
    function save() {
      if (busy) return lastSave = busy.then(save);
      var c = comp.value.trim(), r = rem.value.trim(), n = note.value.trim();
      if (c === saved.c && r === saved.r && n === saved.n) return Promise.resolve(true);
      state.textContent = "Saving..."; state.className = "state";
      return lastSave = busy = Api.cmAdminSaveAnswer(Hub.token(), l.id, c, r, n).then(function () {
        busy = null;
        var was = !!(saved.c || saved.r), now = !!(c || r);
        saved = { c: c, r: r, n: n }; state.textContent = "Saved"; state.className = "state ok";
        if (was !== now) {       // keep the three counters right without reloading the page of lines
          var open = +$("sOpen").textContent + (now ? -1 : 1), done = +$("sDone").textContent + (now ? 1 : -1);
          setCounts({ all: +$("sAll").textContent, open: open, answered: done, review: +$("sReview").textContent });
        }
        return true;
      }, function (err) { busy = null; state.textContent = "Not saved"; state.className = "state err"; fail(err); return false; });
    }
    comp.addEventListener("change", save); rem.addEventListener("change", save); note.addEventListener("change", save);
    var del = el("button", { "class": "btn danger sm", type: "button", text: "Delete", title: "Remove this line from the library",
      onclick: function () {
        Hub.confirm("Use this for junk lines only. The clause and its answer leave the library for every user.", { title: "Delete this line?", ok: "Delete", danger: true }).then(function (yes) {
          if (yes) Api.cmAdminDeleteLine(Hub.token(), l.id).then(function () { Hub.toast("Line deleted"); loadLines(); }, fail);
        });
      } });
    var meta = (l.project_codes && l.project_codes.length ? "Projects " + l.project_codes.join(", ") + " · " : "") + "Seen in " + l.times_seen + (l.times_seen === 1 ? " conversion" : " conversions") +
      (l.answered_at && (l.compliance || l.remarks) ? " · answered " + fmt(l.answered_at) + (l.answered_by ? " by " + l.answered_by : "") + (l.answer_source === "upload" ? " (upload)" : "") : "");
    var text = el("div", {}, CMHighlight.runs(l.spec_text).map(function (r) {
      return r.style ? el("span", { "class": "hl-" + r.style, text: r.text }) : r.text;
    }));
    var kind = l.row_type === "letter" && /^[A-Z]/.test(l.sr || "") ? "letter" : l.row_type === "number" ? "number" : "";
    // Answers users filled in their projects for this clause: who, which project and client, and
    // a button to take a waiting one into the library (or leave it in its project only).
    var who = [], users = el("div", { "class": "pa" });
    if (l.answered_by && (l.compliance || l.remarks)) who.push(l.answered_by);
    (l.project_answers || []).forEach(function (a) {
      if (who.indexOf(a.by) < 0) who.push(a.by);
      var wait = a.review === "pending";
      function decide(decision, btn) {
        btn.disabled = true;
        Api.prReviewDecide(Hub.token(), { run: a.run, seq: a.seq, decision: decision, lineId: l.id }).then(function () {
          Hub.toast(decision === "approve" ? "Taken into the library." : "Left in its project only."); loadLines();
        }, function (err) { btn.disabled = false; fail(err); });
      }
      users.appendChild(el("div", { "class": "pa-item" + (wait ? " wait" : "") }, [
        el("div", {}, [el("b", { text: a.by }), " · " + (a.code ? a.code + " " : "") + a.project + " · " + a.client + " (" + a.client_type + ")" + (a.at ? " · " + fmt(a.at) : "")]),
        el("div", { text: (a.compliance || "(no compliance)") + (a.remarks ? " - " + a.remarks : "") }),
        wait && !editing ? el("div", { "class": "meta", text: "Waiting for a decision. Switch to Edit to take it or turn it down." }) :
        wait ? el("div", { "class": "row" }, [
          // a clause that already has a library answer keeps it: the user's answer can only be turned down, or typed in by hand
          (l.compliance || l.remarks) ? el("span", { "class": "meta", text: "The library already has an answer. It is kept." })
            : el("button", { "class": "btn sm", type: "button", text: "Use this answer", onclick: function (e) { decide("approve", e.currentTarget); } }),
          el("button", { "class": "btn ghost sm", type: "button", text: "Do not take", onclick: function (e) { decide("reject", e.currentTarget); } })])
             : el("div", { "class": "meta", text: a.review === "approved" ? "Taken into the library" : a.review === "rejected" ? "Not taken, project only" : "Same as the library" })
      ]));
    });
    var first = [el("td", { "class": "sr " + kind, text: l.sr || "" }),
      el("td", { "class": "spec" }, [text, el("div", { "class": "meta", text: meta }), users.firstChild ? users : null])];
    // read: plain text, so the page can be searched (Ctrl+F) and read like the document
    if (!editing || (!boxes && lazy.on)) {
      var plain = el("tr", { "class": "line" }, first.concat([
        el("td", { "class": "read", "data-label": "Compliance", text: l.compliance || "" }), el("td", { "class": "read", "data-label": "Remarks", text: l.remarks || "" }),
        el("td", { "class": "note", "data-label": "Internal Comments", text: l.comments || "" }),
        el("td", { "class": "who", "data-label": "Filled by", text: who.join(", ") }),
        el("td", { "class": "end" })
      ]));
      if (editing) { plain._line = l; lazy.watch(plain); }
      return plain;
    }
    var row = el("tr", { "class": "line edit" }, first.concat([
      el("td", { "data-label": "Compliance" }, [comp.box]), el("td", { "data-label": "Remarks" }, [rem]), el("td", { "data-label": "Internal Comments" }, [note]),
      el("td", { "class": "who", "data-label": "Filled by", text: who.join(", ") }),
      el("td", { "class": "end" }, [state, del])       // status above Delete, inside the column: nothing leaves the window
    ]));
    return row;
  }
  function clearFilters() { ["fPart", "fTopic", "fClientType", "fClient", "fCode", "fSearch"].forEach(function (k) { $(k).value = ""; }); filterCount(); offset = 0; loadLines(); }
  function allLines() { $("fStatus").value = "all"; offset = 0; loadLines(); }
  function filterCount() {
    var n = ["fPart", "fTopic", "fClientType", "fClient", "fCode"].filter(function (k) { return $(k).value; }).length;
    $("btnFilters").textContent = n ? "Filters (" + n + ")" : "Filters";
  }
  function loadLines() {
    if (!factoryId()) return;
    filterCount();
    if (loadLines.fresh || !$("rows").firstChild) {          // a new product or factory: the shape of the list, not a blank
      loadLines.fresh = false; lazy.stop();
      $("rows").textContent = "";
      $("rows").appendChild(el("tr", {}, [el("td", { colspan: "7", "class": "lib-empty" }, [Hub.skeleton(5, { flat: true, label: "Loading clauses" })])]));
    }
    var req = factoryId() + "|" + offset + "|" + $("fPart").value + "|" + $("fTopic").value + "|" + $("fClientType").value + "|" + $("fClient").value + "|" + $("fCode").value + "|" + $("fStatus").value;
    loadLines.last = req;
    Api.cmAdminLines(Hub.token(), { factoryId: factoryId(), status: $("fStatus").value, search: $("fSearch").value.replace(/\s+/g, " ").trim(), limit: PAGE, offset: offset,
                                     part: $("fPart").value, topic: $("fTopic").value, clientType: $("fClientType").value, clientName: $("fClient").value, projectCode: $("fCode").value }).then(function (res) {
      if (loadLines.last !== req) return;
      shownLines = res.lines; total = res.total; setCounts(res.counts); fillGroups(res.groups || []); fillClients(res.client_types || [], res.client_names || []); fillCodes(res.project_codes || []);
      var body = $("rows"); body.textContent = ""; lazy.stop();
      if (!res.lines.length) {
        var narrowed = $("fClientType").value || $("fClient").value || $("fCode").value || $("fPart").value || $("fTopic").value || $("fSearch").value;
        var msg = res.counts.all === 0 ? ["No clauses yet for this factory", "They arrive with the first specification converted for it, or with an uploaded library.", null]
                : narrowed ? ["No clause matches", "Nothing fits this search and these filters.", { label: "Clear filters", ghost: true, onClick: clearFilters }]
                : $("fStatus").value === "review" ? ["Nothing to review", "No answer from a user is waiting for this factory.", { label: "Show all lines", ghost: true, onClick: allLines }]
                : $("fStatus").value === "open" ? ["Every clause is answered", "Nothing is left to answer for this factory.", { label: "Show all lines", ghost: true, onClick: allLines }]
                : ["No clauses here", "", { label: "Show all lines", ghost: true, onClick: allLines }];
        var box = el("div", { "class": "empty" });
        body.appendChild(el("tr", {}, [el("td", { colspan: "7", "class": "lib-empty" }, [Hub.emptyState(box, { title: msg[0], text: msg[1], action: msg[2] })])]));
      }
      layout(res.lines).forEach(function (it) {
        if (it.kind === "part") body.appendChild(el("tr", { "class": "part" }, [el("td"), el("td", { colspan: "6", text: it.text })]));
        else if (it.kind === "section") body.appendChild(el("tr", { "class": "sect" }, [
          el("td", { "class": "sr", text: it.sr }),
          el("td", { colspan: "6" }, [it.text, el("span", { "class": "src", text: [it.topic, it.source ? "from " + it.source : ""].filter(Boolean).join(" · ") })])]));
        else body.appendChild(lineRow(it.line));
      });
      $("pageInfo").textContent = total ? "Showing " + (offset + 1) + " to " + Math.min(offset + PAGE, total) + " of " + total : "";
      $("prev").disabled = offset === 0; $("next").disabled = offset + PAGE >= total;
    }, fail);
  }
  // Part and topic filters: filled from what this factory's library holds, with the lines still to answer.
  var PARTS = { 1: "Part 1 General", 2: "Part 2 Products", 3: "Part 3 Execution" };
  function partName(p) { return !p ? "Part not known" : PARTS[p] || "Part " + p; }
  /* Lines come from the database in reading order. Put a PART row where the part changes and a
     section row where the section, or the specification it came from, changes. The same list
     feeds the screen and the Excel download, so both read the same. */
  function layout(lines, code) {
    var out = [], part = null, block = null, byCode = code === undefined ? !!$("fCode").value : !!code;
    lines.forEach(function (l) {
      if (l.part !== part) { part = l.part; block = null; out.push({ kind: "part", part: partName(l.part), text: partName(l.part).toUpperCase().replace(/^(PART \d+) /, "$1 - ") }); }
      var b = (l.section || "").toLowerCase() + "|" + (byCode ? "" : (l.home_run || "")) + "|" + (l.section_sr || "");
      if (b !== block) {
        block = b;
        out.push({ kind: "section", part: partName(l.part), topic: l.topic || "", section: l.section || "", sr: l.section_sr || "",
                   text: l.section || "(no section heading)", source: l.file_name || "" });
      }
      out.push({ kind: "line", line: l, part: partName(l.part), topic: l.topic || "", section: l.section || "", sr: l.sr || "", type: l.row_type || "",
                 spec: l.spec_text, compliance: l.compliance || "", remarks: l.remarks || "", comments: l.comments || "", codes: (l.project_codes || []).join(", ") });
    });
    return out;
  }
  function fillGroups(groups) {
    function fill(sel, first, items) {
      var keep = sel.value;
      sel.textContent = ""; sel.appendChild(el("option", { value: "", text: first }));
      items.forEach(function (it) { sel.appendChild(el("option", { value: it.value, text: it.text })); });
      sel.value = keep; if (sel.value !== keep) sel.value = "";
    }
    var parts = {}, topics = {}, partSel = $("fPart").value;
    groups.forEach(function (g) {
      var p = parts[g.part] || (parts[g.part] = { all: 0, open: 0 }); p.all += g.all; p.open += g.open;
      if (partSel !== "" && String(g.part) !== partSel) return;       // topics of the chosen part only
      var k = g.topic || "";
      var t = topics[k] || (topics[k] = { all: 0, open: 0 }); t.all += g.all; t.open += g.open;
    });
    function tail(c) { return " (" + c.open + " to answer of " + c.all + ")"; }
    fill($("fPart"), "All parts", Object.keys(parts).sort(function (a, b) { return (a === "0") - (b === "0") || a - b; })
      .map(function (k) { return { value: k, text: partName(+k) + tail(parts[k]) }; }));
    fill($("fTopic"), "All topics", Object.keys(topics).filter(Boolean).sort()
      .map(function (k) { return { value: k, text: k + tail(topics[k]) }; }));
  }
  // Client type and client name: the clients of the projects that used this factory.
  function fillClients(types, names) {
    [[$("fClientType"), "All client types", types], [$("fClient"), "All clients", names]].forEach(function (x) {
      var keep = x[0].value; x[0].textContent = ""; x[0].appendChild(el("option", { value: "", text: x[1] }));
      x[2].forEach(function (v) { x[0].appendChild(el("option", { value: v, text: v })); });
      x[0].value = keep; if (x[0].value !== keep) x[0].value = "";
    });
  }
  $("fClientType").addEventListener("change", function () { $("fClient").value = ""; offset = 0; loadLines(); });
  $("fClient").addEventListener("change", function () { offset = 0; loadLines(); });
  // Project code: the lines of one project's specifications, in their order there (section by section)
  function fillCodes(list) {
    var sel = $("fCode"), keep = sel.value; sel.textContent = "";
    sel.appendChild(el("option", { value: "", text: "All projects" }));
    list.forEach(function (x) { sel.appendChild(el("option", { value: x.code, text: x.code + " · " + x.project })); });
    sel.value = keep; if (sel.value !== keep) sel.value = "";
  }
  $("fCode").addEventListener("change", function () { offset = 0; loadLines(); });
  $("fPart").addEventListener("change", function () { $("fTopic").value = ""; offset = 0; loadLines(); });
  $("fTopic").addEventListener("change", function () { offset = 0; loadLines(); });
  $("fStatus").addEventListener("change", function () { offset = 0; loadLines(); });
  $("fSearch").addEventListener("input", function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { offset = 0; loadLines(); }, 300); });
  $("prev").addEventListener("click", function () { offset = Math.max(0, offset - PAGE); loadLines(); window.scrollTo(0, 0); });
  $("next").addEventListener("click", function () { offset += PAGE; loadLines(); window.scrollTo(0, 0); });

  /* Full screen, one clause at a time (cm-focus.js), over the lines of this page and filters. */
  $("btnFocus").addEventListener("click", function () {
    var items = layout(shownLines).filter(function (it) { return it.kind === "line"; }).map(function (it) {
      var l = it.line;
      return { line: l, part: it.part, section: (l.section_sr ? l.section_sr + " " : "") + (l.section || ""), sr: l.sr || "", spec: l.spec_text,
               compliance: l.compliance || "", remarks: l.remarks || "", comments: l.comments || "",
               info: l.answered_by && (l.compliance || l.remarks) ? "Answered by " + l.answered_by : "",
               others: (l.project_answers || []).map(function (a) { return a.by + " · " + a.project + " · " + a.client + ": " + (a.compliance || "(no compliance)") + (a.remarks ? " - " + a.remarks : ""); }) };
    });
    var first = 0; for (var k = 0; k < items.length; k++) if (!items[k].compliance && !items[k].remarks) { first = k; break; }
    CMFocus.open({ title: scopeName() + " library", items: items, start: first,
      choices: LIB_CHOICES,
      save: function (it, v) {
        return Api.cmAdminSaveAnswer(Hub.token(), it.line.id, v.compliance, v.remarks, v.comments).then(function () {
          it.compliance = v.compliance; it.remarks = v.remarks; it.comments = v.comments; return {};
        });
      },
      editing: editing, onMode: function (on) { setMode(on, true); },      // one mode for the page and the pane
      onClose: loadLines });
  });

  // Edit on: every line shows its boxes, Delete and the buttons on users' answers. Edit off: the page reads like the document.
  function setMode(on, quiet) {
    editing = !!on;
    [].forEach.call($("modeSeg").children, function (b) { b.setAttribute("aria-selected", String((b.getAttribute("data-mode") === "edit") === editing)); });
    $("modeNote").textContent = editing ? MODE_EDIT : MODE_READ;
    if (!quiet) settled().then(loadLines, loadLines);   // a box that was just left is saved before the lines are read again
  }
  var lastSave = Promise.resolve();
  function settled() { var p = lastSave; return p.then(function () { return p === lastSave ? null : settled(); }); }   // every save that is under way or queued
  $("modeSeg").addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) setMode(b.getAttribute("data-mode") === "edit"); });
  var MODE_READ = "Reading. Switch to Edit to answer or change lines, and to take or turn down the users' answers. Internal Comments are your notes to the users: they show beside the clause in every user's specification. Text after a # is for the reviewers only: users do not see it.";
  var MODE_EDIT = "Edit is on. Answers save by themselves when you leave a box. Clearing Compliance and Remarks puts the line back under \"To answer\". Internal Comments show to users beside the clause; text after a # is for the reviewers only, hidden from users.";

  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = el("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  // the whole library, or with a project code chosen, only the lines of that project's specifications in their order
  $("btnExport").addEventListener("click", function () {
    var code = $("fCode").value;
    Api.cmAdminExport(Hub.token(), factoryId(), code).then(function (res) {
      if (!res.lines.length) { Hub.toast("There are no lines to download yet."); return; }
      download(xlsxWriter.buildLibrary(layout(res.lines, code), CMHighlight.runs), "compliance-library-" + factoryId() + (code ? "-" + code : "") + ".xlsx");
    }, fail);
  });

  // ---------- upload ----------
  function show(box, text, kind) { box.textContent = text; box.className = "notice " + (kind || "error"); box.hidden = !text; }
  function resetUpload() { pending = null; $("upPreview").hidden = true; $("upResult").hidden = true; show($("upMsg"), ""); $("file").value = ""; }
  /* Find the header row (Sr / Specifications / Compliance / Remarks / Internal Comments; Sr and
     Internal Comments may be missing) and read the clauses under it. PART rows and section rows
     are not clauses: they give each clause its Part, section and section number, so a new clause
     lands in the right place of the library. */
  function readSheet(rows) {
    var head = -1, cs = -1, cc = -1, cr = -1, ci = -1, cn = -1;
    for (var i = 0; i < Math.min(rows.length, 40) && head < 0; i++) {
      var s = -1, c = -1, r = -1, k2 = -1, n = -1;
      rows[i].forEach(function (v, k) {
        v = String(v == null ? "" : v).trim().toLowerCase();
        if (s < 0 && /^specifications?$/.test(v)) s = k;
        else if (c < 0 && /^compliance$/.test(v)) c = k;
        else if (r < 0 && /^remarks?$/.test(v)) r = k;
        else if (k2 < 0 && /^internal comments?$/.test(v)) k2 = k;
        else if (n < 0 && /^sr\.?( ?no\.?)?$/.test(v)) n = k;
      });
      if (s >= 0 && c >= 0) { head = i; cs = s; cc = c; cr = r; ci = k2; cn = n; }
    }
    if (head < 0) throw new Error("This sheet has no Specifications and Compliance column headings. Use the sample file, or a sheet downloaded from the Compliance Maker.");
    function cell(row, k) { return k >= 0 ? String(row[k] == null ? "" : row[k]).trim() : ""; }
    var out = [], part = 0, section = "", sectionSr = "";
    rows.slice(head + 1).forEach(function (row) {
      var spec = cell(row, cs), sr = cell(row, cn), c = cell(row, cc), r = cell(row, cr), note = cell(row, ci);
      if (!spec) return;
      var pm = /^PART\s+([0-9]|I{1,3})\b/i.exec(spec);
      if (pm && !c && !r) { part = { I: 1, II: 2, III: 3 }[pm[1].toUpperCase()] || +pm[1] || 0; section = ""; sectionSr = ""; return; }
      if (/^\d+(\.\d+)+\.?$/.test(sr) && !c && !r && !note) { section = spec.slice(0, 120); sectionSr = sr.replace(/\.$/, ""); return; }
      var label = sr.replace(/[.)]\s*$/, "");
      out.push({ spec: spec, compliance: c, remarks: r, comments: note, sr: label,
                 type: /^[A-Za-z]{1,2}$/.test(label) ? "letter" : /^\d+$/.test(label) ? "number" : "text", part: part, section: section, section_sr: sectionSr });
    });
    return out;
  }
  function takeFile(file) {
    resetUpload(); if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { show($("upMsg"), "Please choose an .xlsx file. Older .xls files need to be saved as .xlsx first."); return; }
    HubXlsx.read(file).then(function (rows) {
      var all = readSheet(rows), ans = all.filter(function (r) { return r.compliance || r.remarks || r.comments; });
      if (!ans.length) { show($("upMsg"), "No filled rows were found. Fill in Compliance, Remarks or Internal Comments for at least one row."); return; }
      pending = { fileName: file.name, rows: ans, read: all.length };
      $("pRows").textContent = all.length; $("pAns").textContent = ans.length; $("pSkip").textContent = all.length - ans.length;
      var body = $("pRowsBody"); body.textContent = "";
      ans.slice(0, 8).forEach(function (r) { body.appendChild(el("tr", {}, [el("td", { text: r.sr }), el("td", { text: r.spec }), el("td", { text: r.compliance }), el("td", { text: r.remarks }), el("td", { text: r.comments })])); });
      $("pMore").textContent = ans.length > 8 ? "First 8 of " + ans.length + " filled rows shown." : "";
      $("upPreview").hidden = false;
      countReplaced(pending);
    })["catch"](function (err) { show($("upMsg"), err && err.message ? err.message : String(err)); });
  }
  /* Before Add to library: how many answers already in the library this file will replace.
     Same rule as the import: one clause is one line (letters and digits only, lower case),
     the last filled row of the file wins, clauses under 8 characters are skipped. */
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function countReplaced(p) {
    var box = $("pReplace"); box.hidden = true;
    Api.cmAdminExport(Hub.token(), factoryId()).then(function (res) {
      if (pending !== p) return;                       // cancelled or another file chosen meanwhile
      var have = {}, mine = {}, fresh = 0, same = 0, repl = 0;
      (res.lines || []).forEach(function (l) { if (l.compliance || l.remarks) have[norm(l.spec_text)] = l; });
      p.rows.forEach(function (r) { var k = norm(r.spec); if (k.length >= 8 && (r.compliance || r.remarks)) mine[k] = r; });
      Object.keys(mine).forEach(function (k) {
        var old = have[k], r = mine[k];
        if (!old) fresh++;
        else if ((old.compliance || "") === r.compliance && (old.remarks || "") === r.remarks) same++;
        else repl++;
      });
      box.textContent = repl ? repl + (repl === 1 ? " clause already has a different answer in the library. This file's answer will replace it" : " clauses already have a different answer in the library. This file's answers will replace them") +
                               ". " + fresh + " new answers, " + same + " already the same."
                             : "No existing answer will be replaced. " + fresh + " new answers, " + same + " already the same.";
      box.className = "notice " + (repl ? "warn" : "ok"); box.hidden = false;   // an uploaded file replaces existing answers: say how many before Add
    }, function (err) {
      if (pending !== p) return;
      box.textContent = "Could not check which answers this file replaces: " + (err && err.message ? err.message : err);
      box.className = "notice warn"; box.hidden = false;
    });
  }
  $("drop").addEventListener("click", function () { $("file").click(); });
  $("drop").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  $("drop").addEventListener("dragover", function (e) { e.preventDefault(); $("drop").classList.add("over"); });
  $("drop").addEventListener("dragleave", function () { $("drop").classList.remove("over"); });
  $("drop").addEventListener("drop", function (e) { e.preventDefault(); $("drop").classList.remove("over"); takeFile(e.dataTransfer.files[0]); });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });
  $("file").addEventListener("change", function (e) { takeFile(e.target.files[0]); });
  $("btnCancel").addEventListener("click", resetUpload);
  /* The sample upload file, built here with invented clauses (the old site shipped a file; this repo is public and keeps none). */
  $("sample").addEventListener("click", function (e) {
    e.preventDefault();
    var rows = [["Sr", "Specifications", "Compliance", "Remarks", "Internal Comments"],
      ["", "PART 1 - GENERAL", "", "", ""],
      ["1.5", "DELIVERY, STORAGE AND HANDLING", "", "", ""],
      ["A.", "Units shall be shipped with labels showing the direction of airflow on each section.", "Comply", "", ""],
      ["B.", "Units shall be stored in a clean, dry place and protected from construction traffic.", "In Contractor's Scope", "Storage on site is by the contractor.", ""],
      ["", "PART 2 - PRODUCTS", "", "", ""],
      ["2.1", "UNIT CASINGS", "", "", ""],
      ["A.", "Casing panels shall be double skin with 50 mm insulation between the skins.", "Comply with Remarks", "62 mm panels offered.", "Note for users # note for reviewers only"]];
    PRXlsx.save(PRXlsx.build([{ name: "Compliance", widths: [8, 90, 22, 44, 40], rows: rows, bold: [0], part: [1, 5], sect: [2, 6] }]), "sample-compliance-upload.xlsx");
  });
  $("btnImport").addEventListener("click", function () {
    if (!pending) return;
    var btn = $("btnImport"); btn.disabled = true;
    var send = function () { return Api.cmAdminImport(Hub.token(), { factoryId: factoryId(), fileName: pending.fileName, rows: pending.rows }); };
    // a library file of another product (an FCU library uploaded into AHU): the editor decides (cm-product-check.js)
    var chosen = products.filter(function (x) { return x.id === productId(); })[0];
    var mismatch = PRProductDetect.mismatch(chosen, products, pending.rows.map(function (r) { return { type: r.type, spec: r.spec }; }));
    (mismatch ? Promise.reject(mismatch) : send()).then(null, function (err) {
      if (!CMProductCheck.is(err)) throw err;
      return CMProductCheck.ask(err).then(function (choice) {
        if (choice === "keep") return send();
        throw new Error(choice === "switch" ? "Nothing was added. Choose " + err.data.detected.name + " and its factory above, then upload the file again." : "Nothing was added.");
      });
    }).then(function (res) {
      btn.disabled = false; var name = pending.fileName, ignored = pending.read - pending.rows.length; resetUpload();
      $("upResultMsg").textContent = name + " added to the library for " + scopeName() + "." +
        (res.standardised ? " " + res.standardised + (res.standardised === 1 ? " answer was" : " answers were") + " put in the standard words (\u201cBy contractor\u201d \u2192 \u201cIn Contractor's Scope\u201d)." : "");
      $("rAdded").textContent = res.added; $("rUpdated").textContent = res.updated; $("rKept").textContent = res.replaced || 0; $("rSame").textContent = res.unchanged; $("rSkipped").textContent = res.skipped + ignored;
      $("upResult").hidden = false; offset = 0; loadLines();
    }, function (err) { btn.disabled = false; show($("upMsg"), err.message); });
  });

  // ---------- runs ----------
  function loadRuns() {
    Api.cmAdminRuns(Hub.token(), { limit: 100 }).then(function (res) {
      var body = $("runRows"); body.textContent = "";
      if (!res.runs.length) body.appendChild(el("tr", {}, [el("td", { colspan: "8", "class": "muted", text: "No conversions yet. A specification converted in any project shows here." })]));
      res.runs.forEach(function (r) {
        var up = r.kind === "library-upload";
        body.appendChild(el("tr", {}, [
          el("td", { "class": "nowrap", text: fmt(r.created_at) }), el("td", { text: r.user }),
          el("td", { text: r.product }), el("td", { text: r.factory }),
          el("td", {}, [el("span", { "class": "badge" + (up ? " brand" : ""), text: up ? "Library upload" : (r.source === "pdf" ? "PDF" : "Pasted text") }), r.file_name ? " " + r.file_name : "", r.project_code ? el("div", { "class": "meta", text: r.project_code }) : null]),
          el("td", { text: String(r.line_count) }), el("td", { text: String(r.unique_count) }),
          el("td", { text: up ? "-" : String(r.matched_count) })
        ]));
      });
      $("runInfo").textContent = res.total > res.runs.length ? "Latest " + res.runs.length + " of " + res.total + " shown." : "";
      cleanState();
    }, fail);
  }

  // ---------- clean a library (super user; also on Admin > Compliance Library) ----------
  var isSuperUser = false;
  function cleanState() {
    $("cleanCard").hidden = !isSuperUser;
    var ok = !!productId() && !!factoryId();
    $("cleanGo").disabled = !ok;
    $("cleanWhat").textContent = ok ? "Library: " + productName() + ", " + factoryName() + " factory." : "Choose a product and a factory above.";
  }
  $("cleanGo").addEventListener("click", function () {
    var name = productName(), what = name + ", " + factoryName() + " factory", all = $("cleanProjects").checked, btn = $("cleanGo"), msg = $("cleanMsg");
    Hub.ask("This empties the compliance library of " + what + " and its history" + (all ? " AND deletes the specifications of this product and factory saved in projects." : ". Specifications saved in projects stay.") + " It cannot be undone.",
      { title: "Clean " + what + "?", hint: "Type " + name + " to confirm.", placeholder: name, ok: "Clean", danger: true }).then(function (typed) {
      if (typed === null) return;
      if (String(typed).trim().toLowerCase() !== name.toLowerCase()) { Hub.toast("Nothing was cleaned: the name typed was not " + name + ".", true); return; }
      btn.disabled = true; msg.hidden = true;
      Api.cmResetLibrary(Hub.token(), { productId: productId(), factoryId: factoryId(), withProjects: all }).then(function (r) {
        btn.disabled = false; msg.hidden = false; msg.className = "notice ok";
        msg.textContent = what + " is clean: " + r.lines_removed + " clauses removed, " + r.lines_kept + " kept without an answer because a project uses them, " +
          r.history_removed + " history entries removed" + (all ? ", " + r.records_removed + " project specifications deleted" : "") + ".";
        Hub.toast("Library cleaned."); loadRuns(); $("factory").dispatchEvent(new Event("change"));
      }, function (err) { btn.disabled = false; msg.hidden = false; msg.className = "notice error"; msg.textContent = (err && err.message) || String(err); });
    });
  });

  function productId() { return $("product").value; }
  function productName() { var p = products.filter(function (x) { return x.id === productId(); })[0]; return p ? p.name : ""; }
  function factoryName() { var o = $("factory").selectedOptions[0]; return o && o.value ? o.textContent : ""; }

  // ---------- tabs ----------
  [].forEach.call(document.querySelectorAll(".tab[data-tab]"), function (tab) {
    tab.addEventListener("click", function () {
      [].forEach.call(document.querySelectorAll(".tab[data-tab]"), function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
        $("tab-" + t.getAttribute("data-tab")).hidden = t !== tab;
      });
      if (tab.getAttribute("data-tab") === "runs") loadRuns();
      libDock();
    });
  });

  $("btnFilters").addEventListener("click", function () {
    var open = $("libFilters").classList.toggle("open"); this.setAttribute("aria-expanded", String(open));
  });
  Hub.requireLogin({ right: "review" }).then(function (profile) {
    isSuperUser = !!profile.is_super;
    $("product").addEventListener("change", cleanState); $("factory").addEventListener("change", cleanState); cleanState();
    $("modeNote").textContent = MODE_READ;
    Hub.autoHide($("workbar"));
    Hub.more($("btnMore"), [$("btnExport")], "Compliance review");
    return CMHighlight.load(); })
    .then(function () { return Api.cmOptions(Hub.token()); }).then(function (res) {
    products = res.products || [];
    var s = $("product"); s.appendChild(el("option", { value: "", text: "Choose a product" }));
    products.forEach(function (p) { s.appendChild(el("option", { value: p.id, text: p.name })); });
    fillFactories();
    // a link may name the factory (?factory=ahu-riyadh) and a project code (?code=P-2026-0001)
    var want = Hub.param("factory"), code = Hub.param("code");
    var owner = want && products.filter(function (p) { return p.factories.some(function (f) { return f.id === want; }); })[0];
    if (owner) {
      s.value = owner.id; fillFactories(); $("factory").value = want;
      if (code) { $("fStatus").value = "all"; $("fCode").appendChild(el("option", { value: code.toUpperCase(), text: code.toUpperCase() })); $("fCode").value = code.toUpperCase(); }
      scopeChanged(); cleanState();
    }
  }, fail);
})();