/* Projects tile - page shim for the pages brought over from Thinkneering (add a specification, the record, compare,
   Focus mode, the matcher, Compliance review, Product Options and the row mapping). Loaded right after pr-common.js, before those scripts. It gives them, on top of the
   DAME core, the small Hub helpers they call (the Tools tile's tl.js pattern) and the old API names as calls to the
   tile's functions (Api.rpc('projects_*')). No sign-in, token, user or theme code is brought over: the core's guard,
   session and topbar are the only ones. Style attributes the old markup set are turned into node.style properties
   (the CSP forbids style="" attributes); no innerHTML is ever used. */
(function () {
  'use strict';
  var core = window.Api;        // the core's Api: rpc, errorMessage, file, auth

  /* ---------- Hub.el: the old builder (children as an array, onclick attributes, style strings) ---------- */
  function el(tag, attrs, children) {
    var n = document.createElement(tag), k;
    for (k in (attrs || {})) {
      var v = attrs[k];
      if (v === false || v == null) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') throw new Error('innerHTML is not used in this tile');
      else if (k === 'style') { String(v).split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) n.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); }); }
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'selected' || k === 'required') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    [].concat(children || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return n;
  }

  /* ---------- sheets: the site's own dialogs (hub-sheet markup, pr-legacy.css) ---------- */
  function sheet(message, o, kind) {
    o = o || {};
    return new Promise(function (resolve) {
      var last = document.activeElement, input = null;
      function done(v) { document.removeEventListener('keydown', key, true); back.remove(); if (last && last.focus) last.focus(); resolve(v); }
      function yes() { done(kind === 'ask' ? input.value : true); }
      function no() { done(kind === 'ask' ? null : false); }
      function key(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); no(); }
        else if (e.key === 'Enter' && (kind !== 'ask' || e.target === input)) { e.preventDefault(); yes(); }
      }
      if (kind === 'ask') input = el('input', { 'class': 'input', type: o.type || 'text', placeholder: o.placeholder || '', autocomplete: 'off', 'aria-label': message });
      var okBtn = el('button', { type: 'button', 'class': 'btn' + (o.danger ? ' solid-danger' : ''), text: o.ok || (kind === 'tell' ? 'OK' : 'Continue'), onclick: yes });
      var box = el('div', { 'class': 'hub-sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title || message }, [
        o.title ? el('h2', { text: o.title }) : null, el('p', { text: message }),
        o.hint ? el('p', { 'class': 'hub-sheet-hint', text: o.hint }) : null, input,
        el('div', { 'class': 'hub-sheet-actions' }, [kind === 'tell' ? null : el('button', { type: 'button', 'class': 'btn ghost', text: o.cancel || 'Cancel', onclick: no }), okBtn])
      ]);
      var back = el('div', { 'class': 'hub-sheet-back', onclick: function (e) { if (e.target === back) no(); } }, [box]);
      document.body.appendChild(back);
      document.addEventListener('keydown', key, true);
      dragClose(box, no);
      (input || okBtn).focus();
    });
  }
  function dragClose(box, close) {
    var y0 = null, dy = 0;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || !window.matchMedia('(max-width: 560px)').matches) return;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|LABEL)$/.test(e.target.tagName) || e.target.closest('button, a, label') || box.scrollTop > 0) return;
      y0 = e.clientY; dy = 0; box.classList.add('dragging');
    });
    box.addEventListener('pointermove', function (e) { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); box.style.transform = dy ? 'translateY(' + dy + 'px)' : ''; });
    function end() { if (y0 === null) return; y0 = null; box.classList.remove('dragging'); if (dy > 90) { box.style.transform = 'translateY(110%)'; setTimeout(close, 180); } else box.style.transform = ''; }
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  }

  /* ---------- the design-pass helpers (skeletons, empty states, More, the dock) ---------- */
  function skeleton(rows, o) {
    o = o || {};
    var box = el('div', { 'class': 'skel' + (o.flat ? ' flat' : ''), role: 'status', 'aria-label': o.label || 'Loading' });
    for (var i = 0; i < (rows || 3); i++) box.appendChild(el('div', { 'class': 'skel-row' }, [el('i', { 'class': 'lg' }), el('i'), el('i', { 'class': 'sm' })]));
    return box;
  }
  function emptyState(host, o) {
    host.textContent = '';
    if (o.title) host.appendChild(el('span', { 'class': 'empty-title', text: o.title }));
    if (o.text) host.appendChild(el('p', { 'class': 'empty-text', text: o.text }));
    var a = o.action;
    if (a) host.appendChild(a.href ? el('a', { 'class': 'btn' + (a.ghost ? ' ghost' : ''), href: a.href, text: a.label })
                                   : el('button', { type: 'button', 'class': 'btn' + (a.ghost ? ' ghost' : ''), text: a.label, onclick: a.onClick }));
    host.hidden = false;
    return host;
  }
  function shownEl(n) { return n && !n.hidden && !n.closest('[hidden]'); }
  function more(btn, items, title) {
    btn.addEventListener('click', function () {
      var list = items.filter(shownEl);
      if (!list.length) return;
      var box, back;
      function close() { document.removeEventListener('keydown', key, true); back.remove(); btn.focus(); }
      function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
      box = el('div', { 'class': 'hub-sheet actions', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'More' }, [
        el('h2', { text: title || 'More' }),
        el('div', { 'class': 'hub-sheet-list' }, list.map(function (n) {
          return el('button', { type: 'button', 'class': 'btn ghost' + (/danger/.test(n.className) ? ' danger-text' : '') + (/\bpr-final\b/.test(n.className) ? ' pr-final' : ''), text: n.textContent.trim(), onclick: function () { close(); n.click(); } });
        })),
        el('div', { 'class': 'hub-sheet-actions' }, [el('button', { type: 'button', 'class': 'btn ghost', text: 'Cancel', onclick: close })])
      ]);
      back = el('div', { 'class': 'hub-sheet-back', onclick: function (e) { if (e.target === back) close(); } }, [box]);
      document.body.appendChild(back); document.addEventListener('keydown', key, true); dragClose(box, close);
      box.querySelector('.hub-sheet-list .btn').focus();
    });
    return btn;
  }
  function dock(buttons) {
    var d = document.querySelector('.dock') || document.body.appendChild(el('div', { 'class': 'dock' }));
    d.textContent = '';
    [].concat(buttons || []).forEach(function (b) { if (b) d.appendChild(b); });
    document.body.classList.toggle('has-dock', !!d.firstChild);
    return d;
  }
  function autoHide(bar) {
    var root = document.documentElement, top = document.getElementById('topbar'), last = window.pageYOffset, run = 0, away = false, tick = false;
    function measure() {
      var th = top ? top.offsetHeight : 0, stuck = bar && bar.getBoundingClientRect().top <= th + 1;
      root.style.setProperty('--hub-top', th + 'px');
      root.style.setProperty('--hub-stick', (away ? 0 : th + (stuck ? bar.offsetHeight : 0)) + 'px');
    }
    function set(on) { if (on !== away) { away = on; root.classList.toggle('hub-away', on); } measure(); }
    function busy() {
      var a = document.activeElement;
      return (a && a !== document.body && ((bar && bar.contains(a)) || (top && top.contains(a)))) || !!document.querySelector('.hub-sheet-back');
    }
    function onScroll() {
      tick = false;
      var y = window.pageYOffset, d = y - last; last = y;
      if (y < 140 || busy()) { run = 0; return set(false); }
      run = (d > 0) === (run > 0) ? run + d : d;
      if (run > 40) set(true); else if (run < -8) set(false); else measure();
    }
    window.addEventListener('scroll', function () { if (!tick) { tick = true; window.requestAnimationFrame(onScroll); } }, { passive: true });
    window.addEventListener('resize', measure);
    document.addEventListener('focusin', function () { if (away && busy()) set(false); });
    if (bar && window.ResizeObserver) new ResizeObserver(measure).observe(bar);
    measure();
    return { show: function () { run = 0; set(false); }, measure: measure };
  }
  var growQueue = [];
  function autoGrow(box) {
    var len = box.value.length;
    box.addEventListener('input', function () {
      if (box.value.length < len) box.style.height = 'auto';
      len = box.value.length;
      var h = box.scrollHeight + 2;
      if (h > box.offsetHeight + 1 || box.style.height === 'auto') box.style.height = Math.min(h, 320) + 'px';
    });
    if (box.value) {
      if (!growQueue.length) window.requestAnimationFrame(function () {
        var q = growQueue; growQueue = [];
        var hs = q.map(function (b) { return b.scrollHeight + 2; });
        q.forEach(function (b, i) { if (hs[i] > b.offsetHeight + 1) b.style.height = Math.min(hs[i], 320) + 'px'; });
      });
      growQueue.push(box);
    }
    return box;
  }
  function lazyRows(make) {
    var io = window.IntersectionObserver ? new IntersectionObserver(function (hits) { hits.forEach(function (h) { if (h.isIntersecting) swap(h.target); }); }, { rootMargin: '700px 0px' }) : null;
    function swap(tr) {
      if (!tr.parentNode || !tr._lazy) return tr;
      var neu = make(tr); if (io) io.unobserve(tr);
      tr.parentNode.replaceChild(neu, tr); return neu;
    }
    return { watch: function (tr) { tr._lazy = true; if (io) io.observe(tr); else return swap(tr); return tr; }, now: swap, on: !!io, stop: function () { if (io) io.disconnect(); } };
  }

  /* ---------- the Compliance of a clause: a pill to pick from, never typed (owner, 2026-11-05: "user must always select
     from drop down only; if anything is needed admin can add in drop down"). A native list, so every answer shows on a
     click and phones get their own picker. The answers are the setting answer_choices (Matching rules > Answers); an
     answer saved before that is not in the list shows as "... (not in the list)" until one of the list is picked.
     .value is '' for no answer. ---------- */
  /* Each answer its own colour (owner, 2026-11-06: "Comply as green is like go"): the core's accent hues, day and night.
     An answer an admin adds takes the tile's colour. */
  var HUES = { 'comply': 'green', 'comply with remarks': 'teal', 'noted': 'blue', 'not comply': 'rose', 'not applicable': 'slate', "in contractor's scope": 'violet' };
  function answerHue(a) { return HUES[String(a || '').trim().toLowerCase()] || ''; }
  /* the answer as a coloured pill to read (Read view); text stays searchable */
  function answerBadge(a) {
    a = String(a || '').trim();
    if (!a) return null;
    return el('span', { 'class': 'answer-pill set static', 'data-accent': answerHue(a) || null, title: a }, [el('span', { 'class': 'answer-text', text: a })]);
  }
  /* The native list sits, invisible, over a pill that shows the whole answer and wraps in a narrow column (owner: "Comply
     with" was cut off). The list keeps the click, the keyboard and the phone's own picker. Put pick.box in the page. */
  function answerPick(value, choices, label) {
    var s = el('select', { 'class': 'answer-pick', 'aria-label': label || 'Compliance' });
    var shown = el('span', { 'class': 'answer-text', 'aria-hidden': 'true' });
    var box = el('span', { 'class': 'answer-pill' }, [shown, el('span', { 'class': 'answer-caret', 'aria-hidden': 'true' }), s]);
    s.box = box;
    function fill(list, v) {
      choices = list; v = v || '';
      while (s.firstChild) s.removeChild(s.firstChild);
      s.appendChild(el('option', { value: '', text: v ? 'No answer' : 'Choose\u2026' }));
      var match = list.filter(function (c) { return c.toLowerCase() === v.toLowerCase(); })[0];
      if (v && !match) s.appendChild(el('option', { value: v, text: v + ' (not in the list)', disabled: true }));
      list.forEach(function (c) { s.appendChild(el('option', { value: c, text: c })); });
      s.value = match || v; paint();
    }
    function paint() {
      var set = !!s.value, odd = set && choices.indexOf(s.value) < 0;
      s.classList.toggle('set', set); s.classList.toggle('odd', odd);
      box.classList.toggle('set', set); box.classList.toggle('odd', odd);
      shown.textContent = set ? (odd ? s.value + ' (not in the list)' : s.value) : 'Choose\u2026';
      box.title = shown.textContent;
      var hue = set && !odd ? answerHue(s.value) : '';
      if (hue) box.setAttribute('data-accent', hue); else box.removeAttribute('data-accent');
    }
    s.addEventListener('change', paint);
    s.setChoices = function (list) { fill(list, s.value); };        // the admin's list, read after the pill was drawn
    fill(choices, value || '');
    return s;
  }
  /* the answers to offer: the setting when the page has it, else the six standard ones */
  function answerChoices() {
    var std = ['Comply', 'Comply with Remarks', 'Noted', 'Not Comply', 'Not Applicable', "In Contractor's Scope"];
    if (!window.PRSettings) return Promise.resolve(std);
    return window.PRSettings.load().then(function (s) { return (s && s.values && s.values.answer_choices) || std; }, function () { return std; });
  }

  /* ---------- the pages' back link ("Back to <place>") ---------- */
  function setBack(label, href) {
    var a = document.getElementById('back');
    if (a) { a.href = href; a.textContent = '← ' + label; }
  }

  window.Hub = {
    el: el, toast: function (msg, isError) { Core.toast(msg, isError ? 'danger' : undefined); },
    confirm: function (message, o) { return sheet(message, o, 'confirm'); },
    ask: function (message, o) { return sheet(message, o, 'ask'); },
    tell: function (message, o) { return sheet(message, o, 'tell'); },
    date: function (iso, time) { return time ? Core.dateTime(iso) : Core.date(iso); },
    param: Core.param, go: Core.go, setBack: setBack,
    skeleton: skeleton, emptyState: emptyState, more: more, dock: dock, dragClose: dragClose,
    autoHide: autoHide, autoGrow: autoGrow, lazyRows: lazyRows, answerPick: answerPick, answerChoices: answerChoices, answerHue: answerHue, answerBadge: answerBadge,
    token: function () { return ''; },                                   // the core sends the session itself
    requireLogin: function (o) { return Core.requireLogin({ tile: PR.TILE, right: o && o.right }); },
    canEdit: function () { return PR.canEdit(Core.user); },
    isAdmin: function () { return !!(Core.user && (Core.user.is_super || Core.user.tile_admin)); },
    isSuper: function () { return !!(Core.user && Core.user.is_super); }
  };

  /* ---------- the old API names, as calls to the tile's functions (the first argument was the old token) ---------- */
  var SAYS = {
    'INVALID:compliance': 'Pick the answer from the list. An admin can add one on Matching rules > Answers.',
    'INVALID:check': 'The rows were changed since this page was opened. Reload the page; nothing was saved.',
    'INVALID:join': 'This row cannot be joined that way: a PART row is never joined, a heading cannot keep an answer, and two rows together cannot be longer than 6000 characters.',
    'INVALID:rows': 'The rows could not be saved: the words must stay the same (only line breaks are added), each row needs text, and a record holds at most 8000 rows.',
    'INVALID:lines': 'There are no lines to save, or more than 8000.',
    'INVALID:factory_id': 'Choose a product and factory first.',
    'INVALID:seq': 'That row cannot be answered. Reload the page.',
    'INVALID:answered': 'The library already has an answer for this clause, so it was kept. Change it in the Compliance and Remarks boxes if it needs correcting.',
    'INVALID:answer': 'An approved answer cannot be empty.',
    'INVALID:decision': 'Unknown decision.',
    'INVALID:nothing': 'Nothing waits or is left to remove there any more. Refresh the page.',
    'INVALID:row_keys': 'Tick the rows first (up to 500 at a time).',
    'INVALID:items': 'Choose the values first (up to 500 at a time).',
    'INVALID:kind': 'Choose special option, note or make (or option / duty figure for a row).',
    'INVALID:place': 'Choose general or per model.',
    'INVALID:section': 'Give the section a name of up to 120 characters.',
    'INVALID:body': 'Type the text first (up to 1000 characters).',
    'INVALID:make': 'A make is a manufacturer\'s name of up to 120 characters.',
    'INVALID:rules': 'The mapping could not be saved: every row needs a name; a name in Excel is up to 120 characters, a remove text 300, the keywords 600 and a response 1000.',
    'NOT_FOUND': 'That no longer exists. Refresh the page.'
  };
  function rpc(name, params) {
    return core.rpc(name, params).then(null, function (err) {
      if (err && SAYS[err.code]) { try { err.message = SAYS[err.code]; } catch (e) { err = { code: err.code, message: SAYS[err.code] }; } }
      throw err;
    });
  }
  core.cmOptions = function () { return rpc('projects_products').then(function (p) { return { products: p || [] }; }); };
  core.prSettings = function () { return rpc('projects_settings_get'); };
  core.prVocab = function (productId) { return rpc('projects_vocab_get', { p_product_id: productId }); };
  core.dnRules = function (t, productId) { return rpc('projects_dn_rules', { p_product_id: productId }); };
  core.prGet = function (t, id) { return rpc('projects_get', { p_id: id }).then(function (d) { return Object.assign({ project: d }, d); }); };
  core.prNoteGet = function (t, id) { return rpc('projects_note_get', { p_id: id }); };
  core.prRunGet = function (t, id) { return rpc('projects_run_get', { p_run_id: id }); };
  core.cmSaveRun = function (t, o) { return rpc('projects_run_save', { p_project_id: o.projectId, p_factory_id: o.factoryId, p_source: o.source, p_file_name: o.fileName, p_lines: o.lines }); };
  core.prRunSaveLine = function (t, o) { return rpc('projects_run_save_line', { p_run_id: o.run, p_seq: o.seq, p_compliance: o.compliance, p_remarks: o.remarks, p_check: o.check == null ? null : o.check }); };
  core.prRunFillSection = function (t, o) { return rpc('projects_run_fill_section', { p_run_id: o.run, p_seq: o.seq, p_compliance: o.compliance, p_replace: !!o.replace, p_check: o.check == null ? null : o.check }); };
  core.prRunSaveReview = function (t, o) { return rpc('projects_run_save_review', { p_run_id: o.run, p_seq: o.seq, p_text: o.text, p_check: o.check == null ? null : o.check }); };
  core.prRunSaveComment = function (t, o) { return rpc('projects_run_save_comment', { p_run_id: o.run, p_seq: o.seq, p_comments: o.comments, p_check: o.check == null ? null : o.check }); };
  core.prRunSplit = function (t, o) { return rpc('projects_run_split', { p_run_id: o.run, p_seq: o.seq, p_rows: o.rows, p_check: o.check == null ? null : o.check }); };
  core.prRunJoin = function (t, o) { return rpc('projects_run_join', { p_run_id: o.run, p_seq: o.seq, p_check: o.check == null ? null : o.check }); };
  core.prSubmitAnswers = function (t, runId, rows) { return rpc('projects_run_submit_answers', { p_run_id: runId, p_rows: rows }); };
  core.prDeleteRecord = function (t, kind, id) { return rpc(kind === 'note' ? 'projects_note_delete' : 'projects_run_delete', { p_id: kind === 'note' ? id : undefined, p_run_id: kind === 'note' ? undefined : id }); };
  core.prExport = function (t, id) { return rpc('projects_export', { p_id: id }); };
  core.poApproved = function (t, factoryId) { return rpc('projects_po_approved', { p_factory_id: factoryId }); };
  /* Compliance review (step 4) */
  core.cmAdminLines = function (t, d) {
    return rpc('projects_lib_lines', { p_factory_id: d.factoryId, p_status: d.status || 'open', p_search: d.search || '', p_part: d.part === '' || d.part == null ? null : +d.part,
      p_topic: d.topic || '', p_client_type: d.clientType || '', p_client_name: d.clientName || '', p_project_code: d.projectCode || '', p_limit: d.limit || 100, p_offset: d.offset || 0 });
  };
  core.cmAdminSaveAnswer = function (t, id, c, r, comments) { return rpc('projects_lib_save_answer', { p_line_id: id, p_compliance: c, p_remarks: r, p_comments: comments == null ? null : comments }); };
  core.cmAdminDeleteLine = function (t, id) { return rpc('projects_lib_delete_line', { p_line_id: id }); };
  core.cmResetLibrary = function (t, d) { return rpc('projects_lib_reset', { p_product_id: d.productId, p_factory_id: d.factoryId || null, p_with_projects: !!d.withProjects }); };
  core.cmAdminImport = function (t, d) { return rpc('projects_lib_import', { p_factory_id: d.factoryId, p_file_name: d.fileName || '', p_rows: d.rows }); };
  core.cmAdminRuns = function (t, d) { return rpc('projects_lib_runs', { p_limit: (d && d.limit) || 50, p_offset: (d && d.offset) || 0 }); };
  core.cmAdminExport = function (t, factoryId, projectCode) { return rpc('projects_lib_export', { p_factory_id: factoryId, p_project_code: projectCode || '' }); };
  core.prReviewDecide = function (t, d) {
    return rpc('projects_review_decide', { p_run_id: d.run, p_seq: d.seq, p_decision: d.decision, p_line_id: d.lineId || null,
      p_compliance: d.compliance == null ? null : d.compliance, p_remarks: d.remarks == null ? null : d.remarks });
  };

  /* Product Options (step 5). The tree comes from projects_po_tree; what each row is (option / duty / accessory /
     project / note, the old lib/po-kind.ts) and what waits for approval are worked out here, as the old po_get_tree
     did on the server, so product-options.js and pr-options.js get the shape they were written for. */
  function poTree(r) {
    var K = window.PRPicks, rev = !!r.can_edit, waiting = 0, updated = null, extraKeys = {}, first = {}, rows = [], perRow = {};
    (r.extras || []).forEach(function (x) { extraKeys[x.key] = 1; });
    (r.rows || []).forEach(function (row) { row.values.forEach(function (v) { if (v.g && !(first[v.g] <= v.seq)) first[v.g] = v.seq; }); });
    function gOrder(a, b) { return a === b ? 0 : a === '' ? -1 : b === '' ? 1 : (first[a] - first[b]) || a.localeCompare(b); }
    (r.rows || []).forEach(function (row) {
      var kind = K ? K.poKind(row.key, row.kind_set) : 'option';
      if (kind === 'project' || kind === 'hide') return;
      var duty = kind === 'duty', live = !row.hidden;
      var list = row.values.slice().sort(function (a, b) { return a.model.localeCompare(b.model) || gOrder(a.g, b.g) || (b.n - a.n) || a.k.localeCompare(b.k); });
      list.forEach(function (v) {
        if (!v.approved && !v.hidden && !duty && live) waiting++;
        if (updated === null || String(v.at) > updated) updated = String(v.at);
        if (v.model !== '') { var pk = v.model + '\u0001' + row.key; perRow[pk] = (perRow[pk] || 0) + v.n; }
      });
      if (!list.length && !extraKeys[row.key]) return;
      rows.push({ key: row.key, section: row.section, sub: row.sub, component: row.component, hidden: !!row.hidden, kind: kind, kind_set: row.kind_set || '', place: row.place || '',
        values: list.map(function (v) { return { k: v.k, v: v.v, n: v.n, hidden: !!v.hidden, model: v.model, g: v.g, wait: !v.approved && !duty && live, held: !v.approved && !duty && !live }; }) });
    });
    var units = {};
    Object.keys(perRow).forEach(function (k) { var m = k.split('\u0001')[0]; units[m] = Math.max(units[m] || 0, perRow[k]); });
    function series(m) { return String(m).replace(/\s*-\s*[A-Z0-9]+$/i, '').replace(/\d+/g, ''); }
    var models = Object.keys(units).map(function (m) { return { model: m, series: series(m), units: units[m] }; })
      .sort(function (a, b) { return a.series.localeCompare(b.series) || (b.units - a.units) || a.model.localeCompare(b.model); });
    return { factory: r.factory, can_edit: rev, can_approve: !!r.can_approve, waiting: rev ? waiting : 0, updated: updated, rows: rows, models: models,
             series_place: r.series_place || [], extras: r.extras || [], sections: r.sections || [] };
  }
  core.poTree = function (t, factoryId) { return rpc('projects_po_tree', { p_factory_id: factoryId }).then(poTree); };
  core.poAdminSaveExtra = function (t, d) { return rpc('projects_po_save_extra', { p_factory_id: d.factoryId, p_id: d.id || null, p_section: d.section, p_row_key: d.key || '', p_kind: d.kind, p_body: d.body }); };
  core.poAdminDeleteExtra = function (t, id) { return rpc('projects_po_delete_extra', { p_id: id }); };
  core.poAdminApprove = function (t, d) { return rpc('projects_po_approve', { p_factory_id: d.factoryId, p_items: d.items || null, p_all: !!d.all, p_approve: !!d.approve }); };
  core.poReset = function (t, d) { return rpc('projects_po_reset', { p_product_id: d.productId, p_factory_id: d.factoryId || null, p_with_extras: !!d.withExtras }); };
  core.poAdminClearUngrouped = function (t, d) { return rpc('projects_po_clear_ungrouped', { p_factory_id: d.factoryId, p_section: d.section, p_drop: d.drop || null, p_groups: d.groups || null }); };
  core.poAdminSetHidden = function (t, d) { return rpc('projects_po_set_hidden', { p_factory_id: d.factoryId, p_row_key: d.key, p_value_key: d.valueKey || '', p_model: d.model || '', p_grp: d.grp || '', p_hidden: !!d.hidden }); };
  core.poAdminSetRowsHidden = function (t, d) { return rpc('projects_po_set_rows_hidden', { p_factory_id: d.factoryId, p_row_keys: d.keys || [], p_hidden: !!d.hidden }); };
  core.poAdminSetPlace = function (t, d) { return rpc('projects_po_set_place', { p_factory_id: d.factoryId, p_row_keys: d.keys || [], p_place: d.place || '', p_series: d.series || '' }); };
  core.poAdminSetKind = function (t, d) { return rpc('projects_po_set_kind', { p_factory_id: d.factoryId, p_row_keys: d.keys || [], p_kind: d.kind || '' }); };
  core.dnAdminSaveRules = function (t, d) { return rpc('projects_dn_save_rules', { p_product_id: d.productId, p_show_unmapped: d.showUnmapped !== false, p_rules: d.rules || [], p_remove: d.remove || [] }); };
})();
