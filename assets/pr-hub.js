/* Projects tile - page shim for the pages brought over from Thinkneering (add a specification, the record, compare,
   Focus mode, the matcher). Loaded right after pr-common.js, before those scripts. It gives them, on top of the
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
          return el('button', { type: 'button', 'class': 'btn ghost' + (/danger/.test(n.className) ? ' danger-text' : ''), text: n.textContent.trim(), onclick: function () { close(); n.click(); } });
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
    autoHide: autoHide, autoGrow: autoGrow, lazyRows: lazyRows,
    token: function () { return ''; },                                   // the core sends the session itself
    requireLogin: function (o) { return Core.requireLogin({ tile: PR.TILE, right: o && o.right }); },
    canEdit: function () { return PR.canEdit(Core.user); },
    isAdmin: function () { return !!(Core.user && (Core.user.is_super || Core.user.tile_admin)); },
    isSuper: function () { return !!(Core.user && Core.user.is_super); }
  };

  /* ---------- the old API names, as calls to the tile's functions (the first argument was the old token) ---------- */
  var SAYS = {
    'INVALID:check': 'The rows of this record were changed since you opened it. Reload the page; nothing was saved on this row.',
    'INVALID:join': 'This row cannot be joined that way: a PART row is never joined, a heading cannot keep an answer, and two rows together cannot be longer than 6000 characters.',
    'INVALID:rows': 'The rows could not be saved: the words must stay the same (only line breaks are added), each row needs text, and a record holds at most 8000 rows.',
    'INVALID:lines': 'There are no lines to save, or more than 8000.',
    'INVALID:factory_id': 'Choose a product and factory first.',
    'INVALID:seq': 'That row cannot be answered. Reload the page.'
  };
  function rpc(name, params) {
    return core.rpc(name, params).then(null, function (err) {
      if (err && SAYS[err.code]) { try { err.message = SAYS[err.code]; } catch (e) { err = { code: err.code, message: SAYS[err.code] }; } }
      throw err;
    });
  }
  core.cmOptions = function () { return rpc('projects_products').then(function (p) { return { products: p || [] }; }); };
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

  /* The old error messages are plain codes now: the pages show Api.errorMessage; an error object keeps .message. */
  /* The Product Options panel of a row (pr-options.js) comes with step 5; until then its name opens a note. */
  window.PROptions = {
    sectionName: function (s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/^\d+\)\s*/, '').replace(/\s*\(\d+\)$/, ''); },
    open: function (o) { return PR.soon('Product Options', 5, 'What the ' + (o && o.factory ? o.factory + ' factory' : 'factory') + ' has offered for "' + ((o && o.component) || 'this row') + '" opens here in step 5, with the special options and notes of the team.'); }
  };
})();
