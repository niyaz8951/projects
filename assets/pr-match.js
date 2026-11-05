/* ============================================================
   Projects - specification lines, datasheet rows and unit values
   brought together for one product of one project.

   PRMatch.load({ projectId, productId, detail, specRows }) -> Promise of
     { product, factory, columns: [unit tag...], keyed, hasNotes, runs, notes,
       table: [{ section, kind: 'row' | 'sub', key, component,
                 spec, found,          the clauses found for the row (text) and whether any was
                 lines: [index...],    positions of those clauses in specRows
                 cells: [value...] }] }  one value per unit column
     detail    the project as Api.prGet gave it (fetched when left out)
     specRows  [{ type, sr, spec }] to match; left out = every specification of the
               product in the project, oldest first

   Rows       = the product's row mapping (Api.dnRules), rows with Show ticked.
   Clauses    = found by the row's Spec keywords (CMRows.match in cm-rows.js, which
                must be loaded first). Keyword matching, not meaning.
   Values     = from every saved datasheet table of the product (Api.prNoteGet). A row
                is tied to its value by the row key saved with the table, or by section
                and component name for tables saved before keys were kept.
   Settings   = the Matching rules page (PRSettings.load, pr-settings.js loaded before cm-rows.js).
   Used by compare.html, record.html and the project Excel (project.html). Brought over from Thinkneering 2026-11-05;
   the result also carries the rules, which pr-picks.js reads for the Product Options picks.
   ============================================================ */
(function () {
  'use strict';
  var Api = window.Api;
  function low(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  // "2) Filter Supply" and "Filter Supply (2)" are the section "filter supply"
  function sec(s) { return low(s).replace(/^\d+\)\s*/, '').replace(/\s*\(\d+\)$/, ''); }

  /* Every unit of every saved table becomes a column; a unit tag read again in a newer table is taken from the
     newest one only (a datasheet read twice does not give its units twice). Returns { columns, entries(row) }:
     entries(row) = every table row the mapping row stands for, in order, each { qual, cells } - a key printed
     twice (Filter Class of Filter 1 and of Filter 2, the second "Empty Section Supply") gives two entries, told
     apart by their order in the table and named by their section as printed ("8) Filter Supply") when the row is in
     several sections, plus their sub-heading ("Filter 1") when it repeats inside one section (owner, 2026-11-05: the
     F9 and H13 chips had no name). Old saved tables ("Filter Supply (2)") work as they are. */
  function unitLookup(notes, columns) {
    var keep = notes.map(function () { return []; }), seen = {};
    for (var t = notes.length - 1; t >= 0; t--) notes[t].columns.forEach(function (tag, i) { keep[t][i] = !seen[tag]; seen[tag] = 1; });
    var at = notes.map(function (note, t) { return note.columns.map(function (tag, i) { if (!keep[t][i]) return -1; columns.push(tag); return columns.length - 1; }); });
    var byId = {}, order = {};
    notes.forEach(function (note, t) {
      var s = '', title = '', sub = '', occ = {};
      note.rows.forEach(function (r) {
        if (r.section) { s = r.section; title = r.section; sub = ''; }
        if (r.kind === 'sub') { sub = r.component || ''; return; }
        var m = /\((\d+)\)\s*$/.exec(title), qual = [m ? sec(title) + ' ' + m[1] : '', sub].filter(Boolean).join(' \u00b7 '), part = t + '|' + title;
        [r.key ? 'k:' + r.key : null, 'n:' + sec(s) + '|' + low(r.component)].forEach(function (k) {
          if (!k) return;
          occ[k] = (occ[k] || 0) + 1;
          var id = k + '#' + occ[k], e = byId[id];
          if (!e) { e = byId[id] = { qual: qual, title: title, part: part, sub: sub, cells: columns.map(function () { return ''; }) }; (order[k] = order[k] || []).push(e); }
          (r.cells || []).forEach(function (v, i) { var c = at[t][i]; if (c >= 0 && c != null) e.cells[c] = v == null ? '' : String(v); });
        });
      });
    });
    // columns may have grown after an entry was made: pad every entry to the full width
    Object.keys(byId).forEach(function (id) { var e = byId[id]; while (e.cells.length < columns.length) e.cells.push(''); });
    return function (row) {
      var list = (row.key && order['k:' + row.key]) || order['n:' + sec(row.section) + '|' + low(row.component)] || [];
      if (list.length < 2) return list.map(function (e) { return { qual: '', cells: e.cells.slice() }; });
      var parts = {}; list.forEach(function (e) { parts[e.part] = (parts[e.part] || 0) + 1; });
      var several = Object.keys(parts).length > 1;
      return list.map(function (e) {
        var q = [several ? e.title.trim() : '', parts[e.part] > 1 ? e.sub : ''].filter(Boolean).join(' \u00b7 ');
        return { qual: q || e.qual, cells: e.cells.slice() };
      });
    };
  }

  /* The factory a saved table names: its General > Factory row, first unit that has one. */
  function factoryOf(rows) {
    var s = '', name = '';
    (rows || []).forEach(function (r) {
      if (r.section) s = r.section;
      if (!name && sec(s) === 'general' && low(r.component) === 'factory') name = ((r.cells || []).filter(function (v) { return v && v !== '-'; })[0]) || '';
    });
    return name;
  }

  function load(o) {
    var t = window.Hub.token();
    var detail = o.detail ? Promise.resolve(o.detail) : Api.prGet(t, o.projectId);
    return detail.then(function (d) {
      var runs = d.runs.filter(function (r) { return r.product_id === o.productId; }).slice().reverse();     // oldest first
      var notes = d.notes.filter(function (n) { return n.product_id === o.productId; }).slice().reverse();
      var product = (runs[0] || notes[0] || {}).product || o.productId;
      var spec = o.specRows ? Promise.resolve(o.specRows)
        : Promise.all(runs.map(function (r) { return Api.prRunGet(t, r.id); })).then(function (got) {
            var rows = []; got.forEach(function (g) { (g.lines || []).forEach(function (l) { rows.push({ type: l.type, sr: l.sr, spec: l.spec }); }); }); return rows;
          });
      // the Matching rules (pr-settings.js) are handed to the matcher before it runs; without them the built-in values hold
      var settings = window.PRSettings ? window.PRSettings.load() : Promise.resolve(null);
      // a product a reviewer switched to the vocabulary (011): its verified vocabulary, else null (Spec keywords as before)
      var vocab = settings.then(function (st) {
        var on = st && st.values && (st.values.vocab_products || []).indexOf(o.productId) >= 0;
        return on && window.PRVocab ? window.PRVocab.load(o.productId).then(function (v) { return v && v.types.length ? { v: v, values: st.values } : null; }) : null;
      });
      return Promise.all([Api.dnRules(t, o.productId).then(function (r) { return (r && r.rules) || []; }, function () { return []; }), spec,
        Promise.all(notes.map(function (n) { return Api.prNoteGet(t, n.id); })), settings, vocab]).then(function (got) {
        var rules = got[0], specRows = got[1], tables = got[2], columns = [], factory = '';
        tables.forEach(function (n) { var f = factoryOf(n.rows); if (f) factory = f; });      // the newest table names it
        var entries = unitLookup(tables, columns), s = '', table = [];
        var byVocab = got[4];
        (byVocab ? window.PRVocab.match(specRows, rules, byVocab.v, byVocab.values) : window.CMRows.match(specRows, rules)).forEach(function (r) {
          if (r.section) s = r.section;
          var base = { section: s, kind: r.kind, key: r.key || '', component: r.component, spec: r.text || '', found: !!r.found, lines: r.lines || [], terms: r.terms || [] };
          if (r.kind === 'sub') { table.push(Object.assign({ cells: [] }, base)); return; }
          var list = entries({ key: r.key, section: s, component: r.component });
          var none = !list.length;      // no datasheet row for it: the vocabulary's "#n" clauses all belong to the one row shown
          if (none) list = [{ qual: '', cells: columns.map(function () { return ''; }) }];
          // one row per table row it stands for: "Filter Class · Filter 1", "Filter Class · Filter 2"
          list.forEach(function (e, n) {
            var one = { component: base.component + (e.qual ? ' \u00b7 ' + e.qual : ''), cells: e.cells };
            // the vocabulary's "#2": a clause that asks for the second row of the key (Filter 2) belongs to that entry only
            if (r.nth) {
              // the highest "#n" a type names also takes the later rows of the key: "#2" (final filter) is the second and
              // every later filter stage, so a unit with F7 + F7 + F9 + H13 shows all three after the pre-filter
              var top = Math.max.apply(null, Object.keys(r.nth).map(Number));
              var extra = none ? Object.keys(r.nth).reduce(function (all, k) { return all.concat(r.nth[k]); }, []) : (r.nth[n + 1] || (n + 1 > top ? r.nth[top] : []));
              one.lines = base.lines.concat(extra.filter(function (x, i, a) { return base.lines.indexOf(x) < 0 && a.indexOf(x) === i; })).sort(function (x, y) { return x - y; });
              one.found = one.lines.length > 0;
            }
            table.push(Object.assign({}, base, one));
          });
        });
        // what the datasheets say, as one text in small letters (sections, sub-headings, rows, values): the "Not
        // Applicable?" hints look in it for what the unit has (pr-hints.js)
        var sheetText = tables.map(function (n) { return (n.rows || []).map(function (r) { return [r.section, r.component].concat(r.cells || []).join(' '); }).join(' '); }).join(' ')
          .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return { product: product, factory: factory, columns: columns, table: table, runs: runs, notes: notes, hasNotes: tables.length > 0, rules: rules, byVocab: !!byVocab, sheetText: sheetText,
                 keyed: rules.filter(function (r) { return r.show !== false && String(r.keywords || '').trim(); }).length };
      });
    });
  }

  function hasValue(r) { return (r.cells || []).some(function (v) { return v && v !== '-'; }); }

  /* The table as rows for an Excel sheet: section name on its first row, rows with nothing on
     either side left out. only = keep just the rows the specification asks about. */
  function sheetRows(m, only) {
    var out = [], last = null, sub = null;
    m.table.forEach(function (r) {
      if (r.kind === 'sub') { sub = r; return; }
      if ((!r.found && !hasValue(r)) || (only && !r.found)) return;
      var first = r.section !== last; last = r.section;
      if (sub && sub.section === r.section) { out.push({ section: first ? r.section : '', component: sub.component, text: '', kind: 'sub', cells: [] }); first = false; }
      sub = null;
      out.push({ section: first ? r.section : '', component: r.component, text: r.spec, kind: 'row', cells: r.cells.map(function (v) { return v || '-'; }) });
    });
    return out;
  }

  window.PRMatch = { load: load, hasValue: hasValue, sheetRows: sheetRows, sectionName: sec, unitLookup: unitLookup };
})();
