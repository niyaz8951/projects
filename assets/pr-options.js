/* ============================================================
   Projects - what the factory offers for one datasheet row.
   Opened from a row name of a saved datasheet table (note.html), of
   the specification-against-datasheet view (compare.html) and of the
   record's datasheet chips (record.html):

     PROptions.open({ productId, product, factory,      factory name read from the datasheet ('' = ask)
                      key, section, component,           the row (key when the table carries it)
                      values: [text] })                  what this project's units have in the row

   Shows the values seen on datasheets for that row at that factory
   (projects_po_tree: approved values only, unless the reader holds
   'review'), marks the ones this project uses, and lists the team's
   special options and notes. Read only: editing stays on the Product
   Options page, linked at the bottom for the reviewers.
   Brought over from Thinkneering (public/tools/projects/pr-options.js)
   and drawn with the core's sheet (Core.sheet, Core.el); its styles
   are in pr.css (.po-panel), not injected.
   ============================================================ */
(function () {
  'use strict';
  var productsP = null, trees = {};

  function el(tag, attrs, kids) { return Core.el(tag, attrs || {}, kids || []); }
  function low(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  // "2) Filter Supply" and "Filter Supply (2)" are the section "filter supply"
  function secName(s) { return low(s).replace(/^\d+\)\s*/, '').replace(/\s*\(\d+\)$/, ''); }
  function times(n) { return 'seen ' + n + (n === 1 ? ' time' : ' times'); }
  function reviewer() { return !!(window.PR && PR.canReview && PR.canReview(Core.user)); }

  function products() { return productsP || (productsP = Api.rpc('projects_products').then(function (r) { return r || []; })); }
  function tree(factoryId) {
    return trees[factoryId] || (trees[factoryId] = Api.rpc('projects_po_tree', { p_factory_id: factoryId }).then(null, function (e) { delete trees[factoryId]; throw e; }));
  }

  function findRow(t, o) {
    var rows = t.rows || [];
    if (o.key) { var byKey = rows.filter(function (r) { return r.key === o.key; })[0]; if (byKey) return byKey; }
    var s = secName(o.section), c = low(o.component);
    return rows.filter(function (r) { return secName(r.section) === s && low(r.component) === c; })[0] || null;
  }

  function open(o) {
    var body = el('div', { class: 'po-panel-body' }, [el('p', { class: 'muted', text: 'Loading…' })]);
    var where = el('p', { class: 'po-panel-where' });
    var wrap = el('div', { class: 'po-panel' }, [where, body]);
    var link = null;
    function fill(nodes) { body.textContent = ''; [].concat(nodes).forEach(function (n) { if (n) body.appendChild(n); }); }

    function show(f) {
      where.textContent = secName(o.section).replace(/^./, function (c) { return c.toUpperCase(); }) + ' · ' + o.product + ', ' + f.name + ' factory';
      link = '/projects/options.html?product=' + encodeURIComponent(o.productId) + '&factory=' + encodeURIComponent(f.id) + '&q=' + encodeURIComponent(o.component);
      fill(el('p', { class: 'muted', text: 'Loading…' }));
      tree(f.id).then(function (t) {
        var row = findRow(t, o), mine = {}, out = [];
        (o.values || []).forEach(function (v) { v = low(v); if (v && v !== '-') mine[v] = 1; });
        // approved values only, never one taken out (a reviewer gets everything from the server: filter it here)
        var dutyRow = row && window.PRPicks && window.PRPicks.poKind(row.key, row.kind_set) === 'duty';
        var vals = row && !dutyRow ? (row.values || []).filter(function (v) { return !v.hidden && v.approved; }) : [];
        // one line per distinct value, however many models had it
        var seen = {}, list = [];
        vals.forEach(function (v) { var k = low(v.v); if (seen[k]) seen[k].n += v.n; else list.push(seen[k] = { v: v.v, n: v.n }); });
        list.sort(function (a, b) { return (mine[low(b.v)] ? 1 : 0) - (mine[low(a.v)] ? 1 : 0) || b.n - a.n; });
        var extras = (t.extras || []).filter(function (x) { return row ? x.key === row.key : false; });
        var secExtras = (t.extras || []).filter(function (x) { return !x.key && secName(x.section) === secName(o.section); });

        if (list.length) out.push(el('div', {}, [el('h3', { text: 'Seen on datasheets' }),
          el('div', { class: 'po-panel-vals' }, list.slice(0, 60).map(function (v) {
            return el('span', { class: 'po-panel-v' + (mine[low(v.v)] ? ' mine' : '') }, [el('span', { text: v.v }), el('small', { text: mine[low(v.v)] ? 'in this project' : times(v.n) })]);
          })), list.length > 60 ? el('p', { class: 'muted small', text: '+ ' + (list.length - 60) + ' more on the Product Options page.' }) : null]));
        var special = extras.concat(secExtras).filter(function (x) { return x.kind === 'option'; });
        if (special.length) out.push(el('div', {}, [el('h3', { text: 'Special options' }), el('div', { class: 'po-panel-vals' }, special.map(function (x) { return el('span', { class: 'po-panel-v special', text: x.body }); }))]));
        var notes = extras.concat(secExtras).filter(function (x) { return x.kind === 'note'; });
        if (notes.length) out.push(el('div', {}, [el('h3', { text: 'Notes from the team' })].concat(notes.map(function (x) { return el('p', { class: 'po-panel-note', text: x.body }); }))));
        // a duty figure (flow, pressure, size ...) is what one selection gives, not an option: it never waits for approval,
        // so it is not offered to users here (owner: nothing goes live unapproved)
        var kind = row && window.PRPicks ? window.PRPicks.poKind(row.key, row.kind_set) : 'option';
        if (kind === 'duty' && !special.length && !notes.length) out.push(el('p', { class: 'muted', text: o.component + ' is a duty figure: what one selection gives (a flow, a pressure, a size ...), not an option the factory offers. The datasheet of each unit says it.' }));
        else if (!out.length) out.push(el('p', { class: 'muted', text: 'Nothing approved is known for this row at the ' + f.name + ' factory yet. It fills up as datasheets are read and their values approved.' }));
        else out.push(el('p', { class: 'muted small', text: 'A value not listed is not known yet. It does not mean the factory cannot offer it.' }));
        if (reviewer()) out.push(el('p', {}, [el('a', { class: 'btn small ghost', href: link, text: 'Open Product Options' })]));
        fill(out);
      }, function (err) { fill(el('div', { class: 'notice danger', text: 'Could not load the options: ' + Api.errorMessage(err) })); });
    }

    Core.sheet({ title: o.component, body: wrap, actions: [{ label: 'Done', value: null }], onOpen: function () {
      products().then(function (list) {
        var p = list.filter(function (x) { return x.id === o.productId || low(x.name) === low(o.product); })[0];
        if (!p) { fill(el('p', { class: 'muted', text: 'This product has no options list.' })); return; }
        o.productId = p.id; o.product = p.name;
        var f = (p.factories || []).filter(function (x) { return low(x.name) === low(o.factory) || x.id === o.factory; })[0];
        if (f) { show(f); return; }
        // the table does not say which factory: ask
        where.textContent = o.product;
        fill([el('p', { class: 'muted', text: 'The datasheet does not name the factory. Choose one:' }),
          el('div', { class: 'po-panel-facs' }, (p.factories || []).map(function (x) { return el('button', { type: 'button', class: 'btn small ghost', text: x.name, on: { click: function () { show(x); } } }); }))]);
      }, function (err) { fill(el('div', { class: 'notice danger', text: 'Could not load the products: ' + Api.errorMessage(err) })); });
    } });
  }

  /* The factory a saved table names: its General > Factory row, first unit that has one. */
  function factoryOf(rows) {
    var sec = '', name = '';
    (rows || []).forEach(function (r) {
      if (r.section) sec = r.section;
      if (!name && secName(sec) === 'general' && low(r.component) === 'factory') name = ((r.cells || []).filter(function (v) { return v && v !== '-'; })[0]) || '';
    });
    return name;
  }

  window.PROptions = { open: open, factoryOf: factoryOf, sectionName: secName };
})();
