/* Projects tile - the compliance record of one specification: read, fill (Edit, Focus mode), split and join rows, one answer
   for a section, Internal Comments (right review), TL Review (tile admins), the two Excel downloads. The old
   tools/projects/record.html script, brought over 2026-11-05 and adapted to the DAME core through pr-hub.js. Left out:
   the AI review, the Focus-mode proposals and the AI drafts (owner: no AI). Changed: the dashed Product Options chips
   are worked out here (pr-picks.js) and shown per row without a datasheet value, beside the blue chips (owner). */
(function () {
  "use strict";
  var el = Hub.el, $ = function (id) { return document.getElementById(id); };
  var runId = Hub.param("run"), run = null, lines = [], editing = false, match = null, sheetOf = {}, selection = null, optOf = {};

  function when(iso) { var d = new Date(iso); return isNaN(d) ? "" : Hub.date(iso); }
  function bare(name) { return String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "") || "Pasted text"; }
  // what the row holds now: the project's own answer, or the library's
  function shown(l) { return l.own ? { c: l.compliance, r: l.remarks } : { c: l.lib_compliance, r: l.lib_remarks }; }
  function filled(l) { var s = shown(l); return !!(s.c || s.r); }
  function stateText(l) {
    if (!l.own) return filled(l) ? "From the library" : "";
    return l.review === "pending" ? "Saved, in review" : l.review === "approved" ? "Saved, approved" : l.review === "rejected" ? "Saved, project only" : "Saved";
  }

  /* The numbers say what they count: answered (by a person or the library), AI drafts still to check, waiting for review. */
  function counts() {
    var can = lines.filter(function (l) { return l.can; }), drafts = can.filter(function (l) { return l.ai_draft; }).length;
    var done = can.filter(filled).length - drafts, rev = can.filter(function (l) { return l.own && l.review === "pending"; }).length;
    $("rc-count").textContent = done + " of " + can.length + " clauses answered" + (drafts ? ", " + drafts + (drafts === 1 ? " AI draft" : " AI drafts") + " to check" : "") + (rev ? ", " + rev + " waiting for review" : "") + ".";
    $("rc-bar").style.width = (can.length ? Math.round(100 * done / can.length) : 0) + "%";
    $("rc-bar-ai").style.width = (can.length ? Math.round(100 * drafts / can.length) : 0) + "%";
    if (run) reviewNote();
  }
  /* An AI draft says why, in one visible line (hover does not exist on a phone). */
  var PRIO = { red: "RED", amber: "AMBER", green: "GREEN" };
  function prio(l) { return l.ai_draft && l.ai && PRIO[l.ai.priority] ? l.ai.priority : l.ai_draft ? "amber" : ""; }
  function why(l) {
    if (!l.ai_draft) return null;
    var a = l.ai || {}, conf = a.confidence ? a.confidence + " confidence" : "", p = prio(l);
    return el("span", { "class": "why" }, [p ? el("span", { "class": "prio " + p, text: PRIO[p] }) : null, el("b", { text: "AI draft" + (conf ? ", " + conf : "") }), a.reason ? " \u2014 " + a.reason : ""]);
  }
  /* What the reviewer has to look at (master prompt v4.1: review RED and AMBER only), and the precedent:
     the earlier record that shares the most identical clauses with this one. */
  function reviewNote() {
    var box = $("rc-review-note"), d = lines.filter(function (l) { return l.ai_draft; }), n = { red: 0, amber: 0, green: 0 };
    d.forEach(function (l) { n[prio(l)]++; });
    var parts = [];
    if (d.length) parts.push("AI drafts: " + n.red + " RED, " + n.amber + " AMBER, " + n.green + " GREEN. Review RED (" + n.red + ") and AMBER (" + n.amber + ") only: choose \u201cTo review\u201d above.");
    var pc = run.precedent;
    if (pc) parts.push("Precedent: " + (pc.project ? pc.project + (pc.file_name ? " (" + bare(pc.file_name) + ")" : "") : "an earlier record of another project") + " has " + pc.same + " of these " + pc.clauses + " clauses word for word, " + pc.answered + " of them answered by people.");
    box.textContent = parts.join(" ");
    box.hidden = !parts.length;
  }

  // sent with every write: the database refuses it when the row with this number is no longer this clause
  // (someone split or joined rows since the page was opened)
  function rowKey(l) { return String(l.spec || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40); }
  /* Save one clause. Back to exactly the library answer, or both boxes emptied: no own answer is kept. */
  function saveLine(l, c, r) {
    var same = c === l.lib_compliance && r === l.lib_remarks;
    return Api.prRunSaveLine(Hub.token(), { run: runId, seq: l.seq, compliance: same ? "" : c, remarks: same ? "" : r, check: rowKey(l) }).then(function (res) {
      l.own = !same && !!(c || r); l.compliance = l.own ? c : ""; l.remarks = l.own ? r : ""; l.review = res.review || "";
      l.ai_draft = false; l.ai = null;                         // a person has now stood behind this row
    });
  }

  /* Full screen, one clause at a time (cm-focus.js). Opens on the first clause still to fill. */
  function focusMode() {
    var part = "", sect = "", items = [];
    lines.forEach(function (l) {
      if (l.type === "part") { part = l.spec; sect = ""; return; }
      if (l.type === "section") { sect = (l.sr ? l.sr + " " : "") + l.spec; return; }
      if (!l.can) return;
      var s = shown(l);
      items.push({ line: l, part: part, section: sect, sr: l.sr, spec: l.spec, compliance: s.c, remarks: s.r, info: l.ai_draft ? "" : stateText(l), lib: !l.own && filled(l),
                   draft: l.ai_draft ? { reason: (l.ai && l.ai.reason) || "", confidence: (l.ai && l.ai.confidence) || "" } : null,
                   comments: run.can_comment ? l.lib_comments || "" : undefined,
                   review: l.tl_review || "", canReview: !!run.can_review,       // a box for the people who may write them, a line of text for everyone else
                   others: (l.lib_comments && !run.can_comment ? ["Internal comment · " + l.lib_comments] : []).concat((sheetOf[lines.indexOf(l)] || []).map(function (d) { var v = chipVerdict(d, l); return "Datasheet · " + d.component + ": " + valueText(d.cells) + (v ? " · " + v.mark : ""); }),
                     (hintsOf[lines.indexOf(l)] || []).filter(function (h) { return h.answer !== s.c; }).map(function (h) { return "Hint · " + h.answer + "? " + h.reason; })) });
    });
    // Opens where the user is: the clause at the top of the window once he has scrolled into the
    // specification, otherwise the first clause still to fill.
    var first = 0, k; for (k = 0; k < items.length; k++) if (!filled(items[k].line)) { first = k; break; }
    var seen = topLine();
    if (seen) for (k = 0; k < items.length; k++) if (lines.indexOf(items[k].line) >= lines.indexOf(seen)) { first = k; break; }
    CMFocus.open({ title: bare(run.file_name), items: items, start: first, choices: CHOICES,
      editing: editing, onMode: function (on) { setMode(on, true); },      // one mode for the page and the pane
      save: function (it, v) {
        var now = shown(it.line), answer = v.compliance === now.c && v.remarks === now.r ? Promise.resolve() : saveLine(it.line, v.compliance, v.remarks);
        var note = v.comments === undefined || v.comments === (it.line.lib_comments || "") ? Promise.resolve()
          : Api.prRunSaveComment(Hub.token(), { run: runId, seq: it.line.seq, comments: v.comments, check: rowKey(it.line) }).then(function () { it.line.lib_comments = v.comments; it.comments = v.comments; });
        var tl = v.review === undefined || v.review === (it.line.tl_review || "") ? Promise.resolve()
          : Api.prRunSaveReview(Hub.token(), { run: runId, seq: it.line.seq, text: v.review, check: rowKey(it.line) }).then(function () { it.line.tl_review = v.review; it.review = v.review; });
        return Promise.all([answer, note, tl]).then(function () {
          var s = shown(it.line); it.compliance = s.c; it.remarks = s.r; it.lib = !it.line.own && filled(it.line); it.info = stateText(it.line);
          if (!it.line.ai_draft) it.draft = null;
          return { info: it.line.own && it.line.review === "pending" ? "sent for review" : "", lib: it.lib };
        });
      },
      onClose: function () { counts(); draw(); } });
  }
  function topLine() {
    var wrap = $("rc-wrap").getBoundingClientRect();
    if (wrap.top > 0) return null;                              // the table has not reached the top of the window yet
    var stick = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hub-stick")) || 0, edge = stick + 44, rows = $("rc-body").children;
    // the first clause that starts in view; a long clause that fills the window counts when none does
    var part = null;
    for (var n = 0; n < rows.length; n++) {
      if (!rows[n]._line) continue;
      var box = rows[n].getBoundingClientRect();
      if (box.top >= edge - 6) return box.top < window.innerHeight - 40 ? rows[n]._line : part;
      if (box.bottom > edge + 40) part = rows[n]._line;
    }
    return part;
  }
  var chipsDue = false;
  $("rc-body").addEventListener("focusout", function () {
    if (!chipsDue) return;
    setTimeout(function () { var a = document.activeElement; if (chipsDue && !(a && $("rc-body").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { chipsDue = false; settled().then(draw); } }, 300);
  });
  // the answers (Matching rules > Answers, 014): picked from a list, never typed; the six standard ones until the setting is read
  var CHOICES = ["Comply", "Comply with Remarks", "Noted", "Not Comply", "Not Applicable", "In Contractor's Scope"];
  var choicesP = Hub.answerChoices().then(function (c) { CHOICES = c; return c; });

  /* In Edit a clause is first drawn as text and gets its boxes when it comes near the window (Hub.lazyRows). */
  var lazy = Hub.lazyRows(function (tr) { return row(tr._line, true); });
  function row(l, boxes) {
    if (l.type === "part") return el("tr", { "class": "part" }, [el("td", { "class": "sr" }), el("td", { colspan: "6", text: l.spec })]);
    if (l.type === "section") {
      // a heading has no answer of its own; in Edit it can give one answer to every clause under it
      var pick = editing ? sectionPick(l) : null;
      var head = el("tr", { "class": "sect" }, [el("td", { "class": "sr", text: l.sr }), el("td", { colspan: pick ? "1" : "6", text: l.spec }), pick ? el("td", { colspan: "5", "class": "rc-sec" }, [pick]) : null]);
      head._line = l; head._fixed = true;
      return head;
    }
    var text = el("div", { "class": "spec" }, CMHighlight.runs(l.spec).map(function (r) { return r.style ? el("span", { "class": "hl-" + r.style, text: r.text }) : r.text; }));
    var kind = l.type === "letter" && /^[A-Z]/.test(l.sr || "") ? "letter" : l.type === "number" ? "number" : "";
    if (!l.can) {            // too short to answer; in Edit it can still be split or joined
      var bare = el("tr", { "class": "line" }, [el("td", { "class": "sr " + kind, text: l.sr }), el("td", { colspan: editing ? "5" : "6" }, [text]), editing ? el("td", { "class": "end" }, [tools(l)]) : null]);
      bare._line = l; bare._fixed = true;
      return bare;
    }

    var s = shown(l), sheet = sheetOf[lines.indexOf(l)] || [];
    // what the datasheet has for the rows this clause is about (found by the row keywords)
    var chips = sheetChips(sheet, l);
    var state = el("span", { "class": "state" + (l.ai_draft ? " ai" : ""), text: stateText(l) }), reason = why(l);
    var rowClass = !l.own && filled(l) ? " lib" : l.ai_draft ? " ai" : "";

    // read: plain text, so the page can be searched (Ctrl+F) and read like the document
    if (!editing || (!boxes && lazy.on)) {
      var plain = el("tr", { "class": "line" + rowClass }, [
        el("td", { "class": "sr " + kind, text: l.sr }), el("td", {}, [text, reason, chips]),
        el("td", { "class": "read", "data-label": "Compliance", text: s.c }), el("td", { "class": "read", "data-label": "Remarks", text: s.r }),
        el("td", { "class": "tl", "data-label": "TL Review", text: l.tl_review || "" }),
        el("td", { "class": "note", "data-label": "Internal Comments", text: l.lib_comments || "" }),
        el("td", { "class": "end" }, stateText(l) ? [state] : [])
      ]);
      plain._line = l;
      if (editing) lazy.watch(plain);
      return plain;
    }
    var comp = Hub.answerPick(s.c, CHOICES);
    var rem = el("textarea", { "class": "input", rows: "1", maxlength: "4000", "aria-label": "Remarks" }); rem.value = s.r; Hub.autoGrow(rem);
    var tr = el("tr", { "class": "line edit" + rowClass }, [
      el("td", { "class": "sr " + kind, text: l.sr }), el("td", {}, [text, reason, chips]), el("td", { "data-label": "Compliance" }, [comp.box]), el("td", { "data-label": "Remarks" }, [rem]),
      run.can_review ? el("td", { "data-label": "TL Review" }, [reviewBox(l)]) : el("td", { "class": "tl", "data-label": "TL Review", text: l.tl_review || "" }),
      run.can_comment ? el("td", { "data-label": "Internal Comments" }, [commentBox(l)]) : el("td", { "class": "note", "data-label": "Internal Comments", text: l.lib_comments || "" }),
      el("td", { "class": "end" }, [state, tools(l)])
    ]);
    tr._line = l;
    // Enter in Compliance goes to the next clause, so a run of answers is typed without the mouse
    comp.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var nx = tr.nextElementSibling;
      while (nx && !(nx.classList.contains("line") && (nx._lazy || nx.querySelector("select.answer-pick")))) nx = nx.nextElementSibling;
      if (nx && nx._lazy) nx = lazy.now(nx);
      if (nx) nx.querySelector("select.answer-pick").focus(); else comp.blur();
    });
    var busy = null;                                    // one save at a time; resolves true when the answer is stored
    function save() {
      if (busy) return track(busy.then(save));
      var c = comp.value.trim(), r = rem.value.trim(), now = shown(l);
      if (c === now.c && r === now.r) return Promise.resolve(true);
      state.className = "state"; state.textContent = "Saving…";
      return track(busy = saveLine(l, c, r).then(function () {
        busy = null;
        if (!l.own) { comp.value = l.lib_compliance; rem.value = l.lib_remarks; }
        tr.className = "line edit" + (!l.own && filled(l) ? " lib" : "");
        if (reason && !l.ai_draft) { reason.remove(); reason = null; }
        state.textContent = stateText(l); counts(); return true;
      }, function (err) { busy = null; state.className = "state err"; state.textContent = "Not saved"; Hub.toast(err.message, true); return false; }));
    }
    comp.addEventListener("change", save); rem.addEventListener("change", save);
    comp.addEventListener("blur", save); rem.addEventListener("blur", save);
    return tr;
  }
  /* ---------- one answer for a whole section ---------- */
  function sectionLines(h) {
    var out = [];
    for (var k = lines.indexOf(h) + 1; k < lines.length && lines[k].type !== "section" && lines[k].type !== "part"; k++) if (lines[k].can) out.push(lines[k]);
    return out;
  }
  function sectionPick(h) {
    var under = sectionLines(h); if (!under.length) return null;
    var sel = el("select", { "class": "input", "aria-label": "One answer for every clause of " + (h.sr ? h.sr + " " : "") + h.spec }, [el("option", { value: "", text: "Answer all " + under.length + (under.length === 1 ? " clause" : " clauses") + " of this section\u2026" })]
      .concat(CHOICES.map(function (c) { return el("option", { value: c, text: c }); }), [el("option", { value: "\u0000clear", text: "Take the answers off this section" })]));
    sel.addEventListener("change", function () {
      var v = sel.value; sel.value = ""; if (!v) return;
      var clear = v === "\u0000clear", name = (h.sr ? h.sr + " " : "") + h.spec, had = sectionLines(h).filter(filled).length, all = sectionLines(h).length;
      var own = sectionLines(h).filter(function (x) { return x.own; }).length;
      var ask = clear ? (own ? Hub.confirm("This takes the " + own + (own === 1 ? " answer" : " answers") + " typed in this project off " + name + ", whoever typed them. Answers from the library show again.", { title: "Take the answers off this section?", ok: "Take them off", danger: true }).then(function (yes) { return yes ? false : null; }) : Promise.resolve(false))
        : had ? choose3(had + " of " + all + " clauses under " + name + " already have an answer.", "Set " + name + " to \u201c" + v + "\u201d?", "Replace all " + all, "Only the " + (all - had) + " empty", all - had > 0)
        : Promise.resolve(false);
      ask.then(function (replace) {
        if (replace === null) return null;              // cancelled: nothing is changed
        sel.disabled = true;
        return settled().then(function () { return Api.prRunFillSection(Hub.token(), { run: runId, seq: h.seq, compliance: clear ? "" : v, replace: replace, check: rowKey(h) }); });
      }).then(function (res) {
        if (!res) return;
        Hub.toast(clear ? (res.filled ? "Your answers were taken off " + res.filled + (res.filled === 1 ? " clause." : " clauses.") : "There was no answer of yours in this section.")
          : res.filled + (res.filled === 1 ? " clause" : " clauses") + " of " + name + " set to " + v + (res.kept ? ", " + res.kept + " kept as they were." : "."));
        return reload();
      }).then(null, function (err) { sel.disabled = false; Hub.toast(err.message || String(err), true); });
    });
    return sel;
  }

  /* A question with two ways to go ahead and a real Cancel (Esc, or a click outside, cancels).
     Resolves true (first way), false (second way) or null (cancelled). */
  function choose3(message, title, first, second, secondOk) {
    return new Promise(function (resolve) {
      function done(v) { document.removeEventListener("keydown", key, true); back.remove(); resolve(v); }
      function key(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); } }
      var box = el("div", { "class": "hub-sheet", role: "alertdialog", "aria-modal": "true", "aria-label": title }, [
        el("h2", { text: title }), el("p", { text: message }),
        el("div", { "class": "hub-sheet-actions", style: "grid-auto-flow:row" }, [
          el("button", { type: "button", "class": "btn", text: first, onclick: function () { done(true); } }),
          secondOk ? el("button", { type: "button", "class": "btn ghost", text: second, onclick: function () { done(false); } }) : null,
          el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: function () { done(null); } })])
      ]);
      var back = el("div", { "class": "hub-sheet-back", onclick: function (e) { if (e.target === back) done(null); } }, [box]);
      document.addEventListener("keydown", key, true); document.body.appendChild(back); box.querySelector(".btn.ghost:last-child").focus();
    });
  }

  /* ---------- Internal Comments, for the people who may edit the library ----------
     The comment belongs to the clause in the library: it shows in Compliance review and in every project that has the clause. */
  function commentBox(l) {
    var box = el("textarea", { "class": "input", rows: "1", maxlength: "4000", "aria-label": "Internal Comments", placeholder: "Note" }); box.value = l.lib_comments || ""; Hub.autoGrow(box);
    function save() {
      var v = box.value.trim(); if (v === (l.lib_comments || "")) return;
      track(Api.prRunSaveComment(Hub.token(), { run: runId, seq: l.seq, comments: v, check: rowKey(l) }).then(function () { l.lib_comments = v; box.classList.remove("unsaved"); Hub.toast("Internal comment saved."); },
        function (err) { box.classList.add("unsaved"); Hub.toast("Internal comment not saved: " + (err.message || String(err)), true); }));
    }
    box.addEventListener("change", save); box.addEventListener("blur", save);
    return box;
  }

  /* ---------- TL Review: the checker's note on one clause of this project ----------
     Written by admins and the super user, read by everyone on the project. It stays in the project: not in the library, not in the Excel. */
  function reviewBox(l) {
    var box = el("textarea", { "class": "input", rows: "1", maxlength: "4000", "aria-label": "TL Review", placeholder: "Review" }); box.value = l.tl_review || ""; Hub.autoGrow(box);
    function save() {
      var v = box.value.trim(); if (v === (l.tl_review || "")) return;
      track(Api.prRunSaveReview(Hub.token(), { run: runId, seq: l.seq, text: v, check: rowKey(l) }).then(function () { l.tl_review = v; box.classList.remove("unsaved"); Hub.toast("TL Review saved."); },
        function (err) { box.classList.add("unsaved"); Hub.toast("TL Review not saved: " + (err.message || String(err)), true); }));
    }
    box.addEventListener("change", save); box.addEventListener("blur", save);
    return box;
  }

  /* ---------- Split and Join: the user puts right what the converter got wrong ----------
     Only the rows change, never the words: the database refuses a split whose text is not the text it was given. */
  function tools(l) {
    var i = lines.indexOf(l), up = lines[i - 1];
    return el("div", { "class": "rc-tools" }, [
      el("button", { type: "button", "class": "rc-tool", text: "Split", title: "Make several rows of this one", onclick: function () { splitSheet(l); } }),
      up && up.type !== "part" && l.type !== "part" ? el("button", { type: "button", "class": "rc-tool", text: "Join up", title: "Put this row at the end of the row above", onclick: function (e) {
        var b = e.currentTarget; b.disabled = true;
        settled().then(function () { return Api.prRunJoin(Hub.token(), { run: runId, seq: l.seq, check: rowKey(l) }); }).then(function () { Hub.toast("Joined to the row above."); reload(); },
          function (err) { b.disabled = false; Hub.toast(err.message || String(err), true); });
      } }) : null
    ]);
  }
  // the numbering of this document, so "3.12 Start-up" is read the way the converter read the rest
  function docStyle() {
    return { classic: lines.some(function (x) { return x.type === "section" && /^\d{1,2}\.0\d$/.test(x.sr); }), deep: lines.some(function (x) { return /^\d{1,2}(\.\d{1,2}){2,}$/.test(x.sr); }) };
  }
  function splitParts(text) {
    var parts = String(text).split(/\n+/).map(function (t) { return t.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    return parts.map(function (t, k) {
      if (!k) return { spec: t };
      // the line as one row, whatever is inside it: its label is read, the rest of the text is left alone
      var r = CMEngine.parseLines([t], { keepBreaks: true, whole: true, style: docStyle() })[0] || { type: "text", sr: "", spec: t };
      return r.type === "part" ? { type: "part", sr: "", spec: t } : { type: r.type, sr: r.sr, spec: r.spec };
    });
  }
  function splitSheet(l) {
    var box = el("textarea", { "class": "input", spellcheck: "false", "aria-label": "The row, one line for each new row" }); box.value = l.spec;
    var note = el("p", { "class": "hub-sheet-hint", role: "status" });
    var go = el("button", { type: "button", "class": "btn", text: "Split", disabled: "" });
    function plainText(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
    function check() {
      var parts = splitParts(box.value), same = plainText(box.value) === plainText(l.spec);
      go.disabled = !same || parts.length < 2;
      note.textContent = !same ? "The words were changed. Only add line breaks; press Reset to start again." : parts.length < 2 ? "Press Enter where a new row should start." : "This makes " + parts.length + " rows.";
      note.style.color = same ? "" : "var(--danger)";
    }
    box.addEventListener("input", check);
    var sheet = el("div", { "class": "hub-sheet rc-split", role: "dialog", "aria-modal": "true", "aria-label": "Split this row" }, [
      el("h2", { text: "Split this row" }),
      el("p", { text: "Click in the text and press Enter where each new row should start. The words stay as they are; a number or letter at the start of a new row becomes its Sr." }),
      box, note,
      el("div", { "class": "hub-sheet-actions" }, [
        el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }),
        el("button", { type: "button", "class": "btn ghost", text: "Reset", onclick: function () { box.value = l.spec; check(); box.focus(); } }), go])
    ]);
    var back = el("div", { "class": "hub-sheet-back", onclick: function (e) { if (e.target === back) close(); } }, [sheet]);
    function key(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
    function close() { document.removeEventListener("keydown", key, true); back.remove(); }
    go.addEventListener("click", function () {
      go.disabled = true;
      settled().then(function () { return Api.prRunSplit(Hub.token(), { run: runId, seq: l.seq, rows: splitParts(box.value), check: rowKey(l) }); }).then(function (res) { close(); Hub.toast("Split into " + res.rows + " rows."); reload(); },
        function (err) { go.disabled = false; note.textContent = err.message || String(err); note.style.color = "var(--danger)"; });
    });
    document.addEventListener("keydown", key, true);
    document.body.appendChild(back); check(); box.focus(); box.setSelectionRange(0, 0);
  }
  /* The rows changed in the database. The page must not keep the old rows: when it cannot read the
     record again it says so and offers the reload, instead of leaving buttons that point at old row numbers. */
  function reload() {
    return refresh().then(null, function () {
      $("rc-body").textContent = "";
      $("rc-main").hidden = true; Hub.dock([]);
      Hub.emptyState($("rc-error"), { title: "Saved, but the page is out of date", text: "The change was saved, but the page could not read the record again.", action: { label: "Reload", onClick: function () { window.location.reload(); } } });
    });
  }
  function refresh() {
    var y = window.pageYOffset;
    return Api.prRunGet(Hub.token(), runId).then(function (res) {
      run = res.run || run; lines = res.lines || []; counts(); draw(); reviewNote(); window.scrollTo(0, y); loadMatch();
    });
  }
  function valueText(cells) {
    var seen = [], out = [];
    (cells || []).forEach(function (v) { v = String(v || "").trim(); if (v && v !== "-" && seen.indexOf(v.toLowerCase()) < 0) { seen.push(v.toLowerCase()); out.push(v); } });
    return out.length ? out.slice(0, 3).join(" / ") + (out.length > 3 ? " and " + (out.length - 3) + " more" : "") : "not on the datasheet";
  }

  /* Headings are kept only when a row under them is shown. */
  function draw() {
    var show = $("rc-show").value, q = $("rc-q").value.trim().toLowerCase(), body = $("rc-body"), frag = document.createDocumentFragment();
    var plain = show === "all" && !q, part = null, sect = null, n = 0;
    lazy.stop(); columns();
    lines.forEach(function (l) {
      if (l.type === "part") { part = l; sect = null; if (plain) frag.appendChild(row(l)); return; }
      if (l.type === "section") { sect = l; if (plain) frag.appendChild(row(l)); return; }
      if (!plain) {
        if (!l.can && show !== "all") return;
        if (show === "open" && filled(l)) return;
        if (show === "filled" && !filled(l)) return;
        if (show === "review" && !(l.own && l.review === "pending")) return;
        if (show === "ai" && !l.ai_draft) return;
        if (show === "check" && !(l.ai_draft && prio(l) !== "green")) return;
        if (q && l.spec.toLowerCase().indexOf(q) < 0) return;
        if (part) { frag.appendChild(row(part)); part = null; }
        if (sect) { frag.appendChild(row(sect)); sect = null; }
      }
      frag.appendChild(row(l)); n++;
    });
    body.textContent = ""; body.appendChild(frag);
    $("rc-wrap").hidden = !n; $("rc-empty").hidden = !!n;
    if (!n) Hub.emptyState($("rc-empty"), { title: "No clause matches", text: show === "ai" ? "There is no AI draft on this record." : show === "check" ? "No AI draft is RED or AMBER." : show === "review" ? "No answer of this record is waiting for review." : show === "open" ? "Every clause shows an answer." : "Nothing fits this search.",
      action: { label: "Show all rows", ghost: true, onClick: function () { $("rc-show").value = "all"; $("rc-q").value = ""; draw(); } } });
  }
  var timer;
  $("rc-show").addEventListener("change", draw);
  $("rc-q").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(draw, 200); });

  $("rc-focus").addEventListener("click", focusMode);
  // Edit on: every clause shows its boxes. Edit off: the page reads like the document.
  function setMode(on, quiet) {
    editing = !!on && !!(run && run.can_edit);
    [].forEach.call($("rc-seg").children, function (b) { b.setAttribute("aria-selected", String((b.getAttribute("data-mode") === "edit") === editing)); });
    $("rc-mode").textContent = editing ? "Edit: a change saves when you leave the box; Enter goes to the next clause. Change a blue answer to make it yours. Split and Join up fix rows the converter got wrong."
                                       : "Reading. Edit to change answers, or Focus mode for one clause at a time. Internal Comments are for you, not the client.";
    if (!quiet) settled().then(remode, remode);      // a box that was just left is saved first
  }
  /* The rows are not drawn again: to Edit, every clause is watched and gets its boxes as it nears the
     window; to Read, only the clauses that have boxes go back to text. Instant on any length. */
  function columns() {
    var t = $("rc-table"), can = run || {};
    t.classList.toggle("no-tl", !(lines.some(function (l) { return l.tl_review; }) || (editing && can.can_review)));
    t.classList.toggle("no-ic", !(lines.some(function (l) { return l.lib_comments; }) || (editing && can.can_comment)));
  }
  function remode() {
    columns();
    var rows = [].slice.call($("rc-body").children);
    lazy.stop();
    rows.forEach(function (tr) {
      if (!tr._line) return;
      if (tr._fixed) tr.parentNode.replaceChild(row(tr._line), tr);
      else if (editing) { if (!tr.classList.contains("edit")) lazy.watch(tr); }
      else if (tr.classList.contains("edit")) tr.parentNode.replaceChild(row(tr._line), tr);
      else tr._lazy = false;
    });
    counts();
  }
  var pending = Promise.resolve();
  // every save joins the queue the page waits for before it redraws, splits or joins; one save never hides another
  function track(p) { var before = pending, quiet = p.then(null, function () {}); pending = before.then(function () { return quiet; }); return p; }
  function settled() { var p = pending; return p.then(function () { return p === pending ? null : settled(); }); }     // every save that is under way or queued
  $("rc-seg").addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) setMode(b.getAttribute("data-mode") === "edit"); });
  /* Sheet 2 of the Excel: every datasheet row with the clause that asks about it and, when the
     project has the datasheet, what each unit has. Without a datasheet every mapped row is listed. */
  function sheet2() {
    if (match && !match.hasNotes && selection && selection.rows && selection.rows.length) return selectionSheet();
    if (match && match.hasNotes && selection && selection.rows && selection.rows.length && !match.table.some(function (r) { return r.kind === "row" && r.found && PRMatch.hasValue(r); })) return selectionSheet();
    if (!match || !match.table.length) return null;
    var s = "";
    var rows = match.hasNotes ? PRMatch.sheetRows(match, false)
      : match.table.map(function (r) { var first = r.section !== s; s = r.section; return { section: first ? r.section : "", component: r.component, text: r.spec, kind: r.kind, cells: [] }; });
    return rows.length ? { name: "Datasheet rows", columns: match.columns, rows: rows } : null;
  }
  /* Without a datasheet: the Selection list. One line per datasheet row the specification asks about: what it asks
     (with the Sr), the value to select in the selection software (the closest approved Product Options value that meets
     it), and the values the factory has shown so far. */
  function selectionSheet() {
    var s = "", rows = [];
    selection.rows.forEach(function (g) {
      var picks = [], asks = [];
      g.lines.forEach(function (x) {
        var p = x.status === "not seen" ? "Not seen yet: ask the factory" : x.pick ? x.pick + (x.status === "meets" ? "" : " (only value seen)") : "Choose: " + g.candidates.slice(0, 3).map(function (c) { return c.value; }).join(" / ");
        if (picks.indexOf(p) < 0) picks.push(p);
        asks.push((x.sr ? x.sr + ". " : "") + (x.required.length ? "asks " + x.required.join(", ") + " - " : "") + x.spec.slice(0, 160));
      });
      var first = g.section !== s; s = g.section;
      rows.push({ section: first ? g.section : "", component: g.component, text: asks.join("\n"),
                  cells: [picks.join(" / "), g.candidates.map(function (c) { return c.value + " (" + c.times + "x)"; }).join(", ")] });
    });
    return { name: "Selection list", columns: ["Select in the software", "Options seen (" + selection.factory + ")"], rows: rows };
  }
  /* Two files (master prompt v4.1): the consultant's, with the four columns and nothing internal, where an AI draft no
     person has checked is left blank and the name ends in _DRAFT while any clause is open; and the working copy. */
  function excelRows(external) {
    return lines.map(function (l) {
      var s = shown(l), out = external && l.ai_draft ? { c: "", r: "" } : s;
      return { type: l.type, sr: l.sr, spec: l.spec, compliance: l.can ? out.c : "", remarks: l.can ? out.r : "",
               auto: external ? null : l.can && !l.own && filled(l) ? { type: "exact" } : l.can && l.ai_draft ? { type: "ai", confidence: (l.ai && l.ai.confidence) || "",
                 reason: (prio(l) ? PRIO[prio(l)] + ". " : "") + ((l.ai && l.ai.reason) || "") } : null };   // an AI draft is flagged in the working copy, with its priority, confidence and reason
    });
  }
  $("rc-download").addEventListener("click", function () {
    var rows = excelRows(true), open = rows.filter(function (r, i) { return lines[i].can && !r.compliance && !r.remarks; }).length;
    var blob = window.xlsxWriter.build(rows, null, function (text) { return CMHighlight.runs(text); },
      { projectName: run.project, bandText: "Product : " + run.product + "     Factory : " + run.factory, external: true });
    PRXlsx.save(blob, bare(run.file_name) + " - compliance" + (open ? "_DRAFT" : "") + ".xlsx");
    Hub.toast(open ? "Excel downloaded as a draft: " + open + (open === 1 ? " clause is" : " clauses are") + " still open (AI drafts nobody checked are left blank)." : "Excel downloaded.");
  });
  $("rc-download-work").addEventListener("click", function () {
    var blob = window.xlsxWriter.build(excelRows(false), null, function (text) { return CMHighlight.runs(text); },
      { projectName: run.project, bandText: "Product : " + run.product + "     Factory : " + run.factory, sheet2: sheet2() });
    PRXlsx.save(blob, bare(run.file_name) + " - compliance (working).xlsx");
    Hub.toast("Working Excel downloaded.");
  });

  $("rc-loading").appendChild(Hub.skeleton(6, { flat: true, label: "Loading the specification" }));
  Hub.requireLogin({}).then(function () {
    if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("No specification was chosen.");
    return Promise.all([Api.prRunGet(Hub.token(), runId), CMHighlight.load()]);
  }).then(function (res) {
    run = res[0].run; lines = res[0].lines || [];
    Hub.setBack(run.project_code + " " + run.project, "/projects/project.html?id=" + encodeURIComponent(run.project_id));
    Core.setTitle(bare(run.file_name) + " - " + run.project_code);
    $("rc-name").textContent = bare(run.file_name);
    var facts = $("rc-facts");
    [(run.project_code ? run.project_code + " · " : "") + run.project, run.product + ", " + run.factory + " factory", "Converted by " + run.user + ", " + when(run.created_at)].forEach(function (t) { facts.appendChild(el("span", { "class": "badge", text: t })); });
    $("rc-loading").hidden = true; $("rc-main").hidden = false;
    if (!run.can_edit) { $("rc-seg").hidden = true; $("rc-mode").textContent = "Reading only."; }
    setMode(false, true); counts(); draw(); reviewNote();
    choicesP.then(function (c) { [].forEach.call(document.querySelectorAll("select.answer-pick"), function (s) { if (s.setChoices) s.setChoices(c); }); });   // the admin's list, in place
    Hub.autoHide($("rc-workbar"));
    Hub.more($("rc-more"), [$("rc-download"), $("rc-download-work")], "This specification");
    Hub.dock([el("button", { type: "button", "class": "btn", text: "Focus mode", onclick: focusMode })]);
    loadMatch();
    // on a phone the table is hard to fill: start in the full-screen mode, "Done" shows the table
    if (window.matchMedia("(max-width: 640px)").matches && lines.some(function (l) { return l.can; })) { if (run.can_edit) setMode(true, true); focusMode(); }
  }, function (err) {
    $("rc-loading").hidden = true; Hub.dock([]);
    Hub.emptyState($("rc-error"), { title: "This specification cannot be opened", text: String((err && err.message) || err), action: { label: "Back to Projects", href: "/projects/" } });
    document.documentElement.removeAttribute("data-loading");
  });

  // the datasheet rows this specification talks about, and their values when the project has the datasheet
  /* No datasheet in the project: what to select in the selection software for the rows a clause is about, from the
     factory's approved Product Options (pr_run_selection): the closest value that meets the clause. */
  function optChips(l) {
    var picks = optOf[l.seq] || [];
    return picks.map(function (p) {
      var text = p.status === "not seen" ? "none seen meets it: ask the factory" : p.pick ? "select " + p.pick : p.reason;
      return el("span", { "class": "rc-chip opt" + (p.status === "not seen" ? " miss" : ""), title: "No datasheet value for this row. From the approved Product Options of " + run.factory + ": " + p.reason + "." },
        [el("b", { text: p.component }), el("span", { text: text })]);
    });
  }
  /* The three helps under a clause: blue chips (the datasheet value of each row the clause asks about), dashed chips
     (what to select, for the rows without a datasheet value); the library's answer is the green pre-filled answer. */
  /* The datasheet value against what the clause asks (PRPicks.verdict): ✓ meets, ✓ better, ≠ check, ✗ below; nothing
     when the clause asks no figure or class this row can be compared with. Worked out once per clause and row. */
  var verdicts = {};
  function chipVerdict(d, l) {
    var i = lines.indexOf(l), id = i + "|" + d.key + "|" + d.component;
    if (id in verdicts) return verdicts[id];
    var rule = (match.rules || []).filter(function (r) { return r.key === d.key; })[0];
    var specRows = specRowsOf || (specRowsOf = lines.map(function (x) { return { seq: x.seq, type: x.type, sr: x.sr, spec: x.spec }; }));
    try {
      return verdicts[id] = PRPicks.verdict({ clause: l.spec, key: d.key, section: d.section, component: d.component, cells: d.cells, columns: match.columns,
        keywords: rule ? rule.keywords : "", terms: d.terms, specRows: specRows, index: i });
    } catch (e) { return verdicts[id] = null; }
  }
  var specRowsOf = null;
  /* Hints (pr-hints.js): "In Contractor's Scope?" and "Not Applicable?". Shown while the clause has another answer; in
     Edit a tap puts the answer in the Compliance box and saves it, as if typed. */
  var hintsOf = {};
  function hintChips(l) {
    var c = shown(l).c;
    // only answers that are in the list (an admin may have renamed or removed one)
    return (hintsOf[lines.indexOf(l)] || []).filter(function (h) { return h.answer !== c && CHOICES.indexOf(h.answer) >= 0; }).map(function (h) {
      return el("button", { type: "button", "class": "rc-chip hint", title: h.answer + "? " + h.reason + "." + (editing ? " Press to answer it." : " Switch to Edit to answer it with one press."),
        onclick: function (e) {
          var tr = e.currentTarget.closest("tr"), box = tr && tr.querySelector("select.answer-pick");
          if (!box) { Hub.toast("Switch to Edit, then press the hint to answer it."); return; }
          box.value = h.answer; box.dispatchEvent(new Event("change"));        // saved as if typed; Remarks stay the reader's
          e.currentTarget.remove();
        } }, [el("b", { text: h.answer + "?" }), el("span", { text: h.reason })]);
    });
  }
  function sheetChips(sheet, l) {
    var blue = sheet.map(function (d) {
      var v = chipVerdict(d, l);
      return el("button", { type: "button", "class": "rc-chip" + (v ? " v-" + v.kind : ""),
        title: (v ? v.reason + " " : "") + "From the datasheet. Press to see what the factory offers for this row.", onclick: function () {
        PROptions.open({ productId: run.product_id, product: run.product, factory: match.factory || run.factory, key: d.key, section: d.section, component: d.component, values: d.cells });
      } }, [el("b", { text: d.component }), el("span", { text: valueText(d.cells) }), v ? el("i", { "class": "rc-mark", text: v.mark }) : null]);
    });
    var all = blue.concat(optChips(l), hintChips(l));
    return all.length ? el("div", { "class": "rc-sheet" }, all) : null;
  }
  /* Rows a clause asks about that have no datasheet value: what to select, from the factory's approved Product Options
     (PRPicks.build, the old pr_run_selection worked out here): the closest value that meets the clause. Per row: a clause
     keeps its blue chips for the rows the datasheet answers and gets dashed chips for the others (owner, 2026-11-05). */
  function loadSelection(m) {
    Api.poApproved(Hub.token(), run.factory_id).then(function (approved) {
      selection = PRPicks.build({ lines: lines, match: m, approved: approved }); optOf = selection.by_seq || {};
      var n = Object.keys(optOf).length, note = $("rc-sheet-note");
      if (n) {
        note.hidden = false;
        note.textContent = (m.hasNotes ? "The datasheet has no value for some rows the clauses ask about: " : "No " + run.product + " datasheet in this project. ") + n + (n === 1 ? " clause shows" : " clauses show") +
          " what to select in the selection software (dashed chips: the closest approved " + run.factory + " Product Options value that meets the clause). The working Excel lists them on its Selection list sheet." +
          (m.hasNotes ? "" : " Read the datasheet into the project once the units are selected.");
        if (!CMFocus.isOpen()) settled().then(function () {
          var a = document.activeElement;
          if (a && $("rc-body").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { chipsDue = true; return; }
          draw();
        });
      }
    }, function () { /* the specification still reads and fills without it */ });
  }
  function loadMatch() {
    PRMatch.load({ projectId: run.project_id, productId: run.product_id, specRows: lines.map(function (l) { return { type: l.type, sr: l.sr, spec: l.spec }; }) }).then(function (m) {
      match = m; sheetOf = {}; verdicts = {}; specRowsOf = null; hintsOf = {};
      var hinted = 0;
      if (window.PRHints) {
        var st = window.PRSettings && window.PRSettings.DEFAULTS ? window.PRSettings.load() : Promise.resolve(null);
        st.then(function (s) {
          var built = PRHints.build({ lines: lines, values: (s && s.values) || PRSettings.DEFAULTS, product: run.product_id, sheet: m.hasNotes ? m.sheetText : "" });
          hintsOf = built.by_index; hinted = built.count;
          if (hinted && !CMFocus.isOpen()) settled().then(function () {
            var a = document.activeElement;
            if (a && $("rc-body").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { chipsDue = true; return; }
            draw();
          });
        });
      }
      loadSelection(m);
      // a row the datasheet has a value for is a blue chip; a row without one gets the dashed Product Options chip instead (per row, owner)
      m.table.forEach(function (r) { if (r.kind === "row" && r.found && m.hasNotes && PRMatch.hasValue(r)) r.lines.forEach(function (i) { (sheetOf[i] = sheetOf[i] || []).push(r); }); });
      var n = Object.keys(sheetOf).length, note = $("rc-sheet-note");
      note.hidden = false;
      note.textContent = !m.hasNotes ? "No " + run.product + " datasheet in this project yet. Read one and its values appear beside the clauses that ask about them; the Excel gets them on its second sheet."
        : n ? n + (n === 1 ? " clause has" : " clauses have") + " the datasheet value beside " + (n === 1 ? "it" : "them") + " (blue chips). Found by " + (m.byVocab ? "the vocabulary and the row keywords" : "the row keywords") + ", not by meaning: read before you rely on it. \u2713 / \u2260 / \u2717 on a chip compare its figure with the clause."
        : "The datasheet is in the project, but no clause matched a row keyword. An editor adds keywords in Product Options > Row mapping.";
      // the datasheet names its factory (Material Name): a specification converted for another factory gets the wrong library and options
      var other = m.hasNotes && m.factory && run.factory && m.factory.toLowerCase() !== String(run.factory).toLowerCase();
      $("rc-factory-warn").hidden = !other;
      if (other) $("rc-factory-warn").textContent = "The datasheet in this project is from the " + m.factory + " factory, but this specification was converted for " + run.factory +
        ". The library answers and Product Options are those of " + run.factory + ". Convert the specification again for " + m.factory + " if the units come from there.";
      // the datasheet chips need a redraw; never while the user is typing in a box of the table
      if (n && !CMFocus.isOpen()) settled().then(function () {
        var a = document.activeElement;
        if (a && $("rc-body").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { chipsDue = true; return; }
        draw();
      });
    }, function () { /* the specification still reads and fills without it */ });
  }


})();