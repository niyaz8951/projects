/* Projects tile - Read a datasheet into a project. Brought over from Thinkneering's tools/datasheet-notes/datasheet-notes.js
   (2026-11-05) and adapted to the DAME core: the project is fixed by the link (?project=<id>), the old API calls are
   Core/Api calls (projects_products, projects_dn_rules, projects_dn_add_rows, projects_po_collect, projects_note_save).
   The PDF is read in the browser (ds-read.js, ds-parse.js, ds-fcu.js) and never uploaded; only the table is saved.
   Which rows appear and what they say follows the product's row mapping (one list per product, every factory, every user);
   row names the mapping has not seen are added to it; the values of the mapped rows go to Product Options "to approve". */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;

  var productSel, hint, upload, result, drop, fileInput, status, mapNote;
  var project = null, products = [], parsed = null, grid = null, fileName = '', busy = false;   // parsed: [unit, ...]
  var failed = [], runNo = 0;                    // failed: files of the last run that could not be read
  var narrow = window.matchMedia('(max-width: 560px)');
  var mappings = {}, mapping = null, mapProduct = '';   // mapping per product, loaded once each
  var DSParse = window.DSParse, DSRead = window.DSRead;

  /* ---------- selection ---------- */
  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function choice() { var p = product(); return p ? { productId: p.id, product: p.name } : null; }
  function canRead(p) { return !!(p && DSParse.readers[String(p.id).toLowerCase()]); }

  /* The row mapping for the chosen product. If it cannot be loaded the reader still works and shows every row, with a notice. */
  function loadMapping(productId) {
    mapProduct = productId; mapping = mappings[productId] || null;
    mapNote.hidden = true;
    if (!productId || mapping) return;
    Api.rpc('projects_dn_rules', { p_product_id: productId }).then(function (res) {
      var rules = {};
      (res.rules || []).forEach(function (r) { rules[r.key] = r; });
      mappings[productId] = { showUnmapped: res.show_unmapped !== false, rules: rules, count: (res.rules || []).length };
    }, function (err) {
      mappings[productId] = { showUnmapped: true, rules: {}, count: 0, error: Api.errorMessage(err) };
    }).then(function () { if (mapProduct === productId) { mapping = mappings[productId]; applyGate(); } });
  }

  function applyGate() {
    var p = product(), c = choice();
    hint.className = 'hint';
    if (p && !canRead(p)) {
      hint.className = 'notice warning';
      hint.textContent = 'The ' + p.name + ' datasheet reader is not ready yet. Only ' + Object.keys(DSParse.readers).map(function (k) { return k.toUpperCase(); }).join(' and ') + ' datasheets can be read for now.';
      upload.hidden = true; result.hidden = true;
      return;
    }
    hint.textContent = c ? 'The unit tags, the factory and the power supply are read from the datasheet.' : 'Choose a product to continue.';
    var ready = !!(c && mapping);
    upload.hidden = !ready;
    mapNote.hidden = !(ready && mapping.error);
    if (ready && mapping.error) mapNote.textContent = 'The row mapping for this product could not be loaded (' + mapping.error + '). Every datasheet row is shown as printed.';
    if (!ready) result.hidden = true;
    else if (parsed) render();            // the mapping has loaded: draw the table
  }

  /* A result belongs to the product it was read for: changing the product clears it. */
  function clearResult() { parsed = null; grid = null; fileName = ''; failed = []; result.hidden = true; say(''); $('#dn-saved').hidden = true; }

  /* ---------- file ---------- */
  function say(text, kind) {
    status.hidden = !text;
    status.className = 'notice' + (kind ? ' ' + kind : '');
    status.textContent = text || '';
  }

  /* Cancel: the run in hand is dropped (its number no longer matches) and the reader stops at the next page. */
  function stop() { runNo++; busy = false; drop.disabled = false; $('#dn-cancel').hidden = true; say(''); }

  function read(files) {
    var c = choice();
    if (!c) return;
    var no = ++runNo, stopped = function () { return no !== runNo; };
    busy = true; drop.disabled = true; parsed = null; failed = []; result.hidden = true;
    $('#dn-cancel').hidden = false;
    say('Reading ' + (files.length === 1 ? files[0].name : files.length + ' files') + '…');
    // each file is checked against the product: an FCU datasheet run as AHU would be mapped under the wrong product
    DSRead.files(files, DSRead.progress(say, stopped), c.productId, stopped).then(function (units) {
      if (stopped()) return;
      say('Building the table for ' + units.length + (units.length === 1 ? ' unit…' : ' units…'));
      return new Promise(function (go) { setTimeout(go, 30); }).then(function () {   // let the message show first
        if (stopped()) return;
        parsed = units; fileName = units.names[0]; failed = units.failed;
        say('');
        render();
        register();
        keep(c, units.names || []);
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }).then(null, function (err) { if (!stopped()) say(err.message, 'danger'); })
      .then(function () { if (!stopped()) { busy = false; drop.disabled = false; $('#dn-cancel').hidden = true; } });
  }

  /* Row names this product's mapping has not seen before are added to the mapping, so new sections and rows turn up
     on the row-mapping page without anyone loading the datasheet again. Only names go to the database, never values. */
  function register() {
    var c = choice();
    if (!parsed || !c || !mapping || mapping.error) return;
    var seen = {}, fresh = [], m = mapping;
    parsed.forEach(function (unit) {
      DSParse.rows(unit, c).forEach(function (r) {
        if (m.rules[r.key] || seen[r.key]) return; seen[r.key] = 1;
        fresh.push({ key: r.key, section: r.group, sub: /^Filter \d+$/i.test(r.sub) ? '' : r.sub, component: r.component });
      });
    });
    var units = parsed;
    if (!fresh.length) { collect(c, m, units); return; }
    Api.rpc('projects_dn_add_rows', { p_product_id: c.productId, p_rows: fresh }).then(function () {
      // remembered as they were added, so the next datasheet in this visit does not send them again
      fresh.forEach(function (r) { m.rules[r.key] = { key: r.key, show: m.showUnmapped, label: '', response: '' }; });
    }, function () { /* the next run sends them again */ }).then(function () { collect(c, m, units); });
  }

  /* The values of the rows the mapping shows go to the Product Options of the unit's factory (the factory read from the
     datasheet), as "to approve". The database takes only mapped rows and never the project, reference, material name,
     report date or unit tag; they are not sent either. The value is sent as printed, after the row's "Remove text". */
  var PROJECT_ROWS = /^general\|\|(?!power supply$)/;
  // FCU trees are kept per unit model (series > model): the model is the datasheet's Unit Model row.
  var MODEL_ROW = { fcu: 'unit data||unit model' };
  /* Values that belong together are saved as one group of Product Options (DSParse.poGroups): each filter with its
     class, each fan with its model, each heat wheel with its part number, the casing with its model box. Not for
     products kept per unit model (FCU). */
  function groupsOf(rows, strip, perModel) {
    return perModel ? rows.map(function () { return ''; }) : DSParse.poGroups(rows, strip);
  }
  function collect(c, m, units) {
    var items = [];
    units.forEach(function (unit) {
      if (!unit.hdr.factory) return;
      var rows = DSParse.rows(unit, c), modelKey = MODEL_ROW[unit.type], model = '';
      if (modelKey) rows.forEach(function (r) { if (r.key === modelKey && !model) model = DSParse.fill('', r.value); });
      var valueOf = function (r) { var rule = m.rules[r.key]; return DSParse.fill('', r.value, rule && rule.strip); };
      var grp = groupsOf(rows, valueOf, !!modelKey);
      rows.forEach(function (r, i) {
        var rule = m.rules[r.key];
        if (PROJECT_ROWS.test(r.key) || (rule ? rule.show === false : !m.showUnmapped)) return;
        var v = valueOf(r);
        if (v && v !== '-') items.push({ factory: unit.hdr.factory, key: r.key, value: v, model: model, grp: grp[i] || '' });
      });
    });
    // the database takes at most 20000 values per call; a long FCU schedule gives more
    var chain = Promise.resolve();
    for (var i = 0; i < items.length; i += 20000) (function (part) {
      chain = chain.then(function () { return Api.rpc('projects_po_collect', { p_product_id: c.productId, p_items: part }); });
    })(items.slice(i, i + 20000));
    chain.then(null, function () { /* Product Options misses this run */ });
  }

  /* Does the datasheet fit the project's site? The selection location's country and the power supply frequency of the
     table against the project's region (the old lib/site.ts). A warning only: nothing is refused or changed. */
  var SITES = {
    'uae': { country: /\b(united arab emirates|u\.?a\.?e\.?|dubai|abu dhabi|sharjah)\b/i, hz: 50 },
    'saudi arabia': { country: /\b(saudi arabia|k\.?s\.?a\.?|saudi)\b/i, hz: 60 },
    'qatar': { country: /\bqatar\b/i, hz: 50 }, 'kuwait': { country: /\bkuwait\b/i, hz: 50 },
    'bahrain': { country: /\bbahrain\b/i, hz: 50 }, 'oman': { country: /\boman\b/i, hz: 50 }, 'egypt': { country: /\begypt\b/i, hz: 50 }
  };
  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function sectionOf(s) { return tidy(s).replace(/^\d+\)\s*/, '').replace(/\s*\(\d+\)$/, '').toLowerCase(); }
  function tableValues(rows, section, component) {
    var out = [], sec = '';
    (rows || []).forEach(function (r) {
      if (r && r.section) sec = tidy(r.section);
      if (!r || sectionOf(sec) !== section || tidy(r.component).toLowerCase() !== component) return;
      (r.cells || []).forEach(function (c) { var v = tidy(c); if (v && v !== '-' && out.indexOf(v) < 0) out.push(v); });
    });
    return out;
  }
  function siteWarnings(region, rows) {
    var name = tidy(region), site = SITES[name.toLowerCase()];
    if (!site) return [];
    var out = [];
    var away = tableValues(rows, 'unit data', 'location').filter(function (l) { return l && !site.country.test(l); });
    if (away.length) out.push('The datasheet was selected at ' + away.join('; ') + ', but the project is in ' + name + '. Outdoor conditions, air density and coil capacities may not fit the site: check the selection before answering from it.');
    var wrongHz = tableValues(rows, 'general', 'power supply').filter(function (p) { var m = /(\d{2})\s*hz\b/i.exec(p); return m && Number(m[1]) !== site.hz; });
    if (wrongHz.length) out.push('The datasheet’s power supply is ' + wrongHz.join('; ') + ', but ' + name + ' uses ' + site.hz + ' Hz. Check the motors and electrical data.');
    return out;
  }

  /* The table on screen is saved in the project, once per read. The Excel does not wait for it. */
  function keep(c, names) {
    var box = $('#dn-saved'), no = runNo;
    function tell(text, kind) { if (no !== runNo) return; box.hidden = false; box.className = 'notice' + (kind ? ' ' + kind : ''); box.textContent = text; }
    box.hidden = true;
    if (!project || !grid || !grid.rows.length) return;
    var rows = grid.rows.map(function (r) { return { section: r.section || '', component: r.component || '', cells: r.cells || [], marks: r.marks || null, kind: r.kind || 'row', key: r.key || '' }; });
    if (JSON.stringify(rows).length > 11000000) {
      tell('This table is too large to save in the project (' + grid.columns.length + ' units). Download the Excel and keep it, or read the datasheets in smaller groups.', 'warning');
      return;
    }
    // the factory the datasheets name (Material Name ...9 Riyadh, ...5 Dubai); several factories in one run = none
    var facs = [];
    parsed.forEach(function (u) { if (u.hdr.factory && facs.indexOf(u.hdr.factory) < 0) facs.push(u.hdr.factory); });
    tell('Saving in ' + project.name + '…');
    Api.rpc('projects_note_save', { p_project_id: project.id, p_product_id: c.productId, p_file_names: names.join(', '),
                                    p_columns: grid.columns, p_rows: rows, p_factory: facs.length === 1 ? facs[0] : '' }).then(function (res) {
      var warning = siteWarnings(project.region, rows).join(' ');
      tell('Saved in ' + project.name + (res && res.replaced ? ', in place of the earlier table of the same units' : '') +
           '. Go back to the project to see it, or read another datasheet.' +
           (facs.length > 1 ? ' These datasheets name more than one factory (' + facs.join(', ') + '): read each factory’s datasheets on their own.' : '') +
           (facs.length === 1 && res && !res.factory_id ? ' The datasheet names the factory "' + facs[0] + '", which is not one of the ' + c.product + ' factories: the table is kept without a factory.' : '') +
           (warning ? ' ' + warning : ''), facs.length > 1 || warning || (res && !res.factory_id) ? 'warning' : 'success');
    }, function (err) {
      tell('The table was not saved in the project: ' + Api.errorMessage(err) + ' Download the Excel now and read the datasheet again later.', 'danger');
    });
  }

  /* ---------- result ---------- */
  function count(g) { return g.rows.filter(function (r) { return r.kind !== 'sub'; }).length; }
  function projectsNamed() {
    var seen = [];
    parsed.forEach(function (u) { if (u.hdr.project && seen.indexOf(u.hdr.project) < 0) seen.push(u.hdr.project); });
    return seen;
  }

  /* The rows to draw. With "Only rows that differ" ticked, rows that match the first unit are dropped; the section
     name and the sub-heading move to the first row that is kept. The Excel always holds every row. */
  function onScreen() {
    if (!$('#dn-only').checked) return grid.rows;
    var out = [], sec = '', secDone = true, sub = null;
    grid.rows.forEach(function (r) {
      if (r.section) { sec = r.section; secDone = false; sub = null; }
      if (r.kind === 'sub') { sub = r; return; }
      if (!r.marks || !r.marks.some(Boolean)) return;
      if (sub) { out.push({ section: secDone ? '' : sec, component: sub.component, cells: sub.cells, kind: 'sub' }); secDone = true; sub = null; }
      out.push({ section: secDone ? '' : sec, component: r.component, cells: r.cells, marks: r.marks, kind: 'row' });
      secDone = true;
    });
    return out;
  }

  function render() {
    var c = choice();
    if (!parsed || !c || !mapping) return;
    grid = DSParse.grid(parsed, c, mapping);
    var units = grid.columns.length, shown = count(grid), total = count(DSParse.grid(parsed, c, null));

    var h = parsed[0].hdr, named = grid.columns.slice(0, 12);
    $('#dn-title').textContent = (units === 1
      ? [h.project, grid.columns[0], h.reference ? 'Ref. ' + h.reference : '']
      : [projectsNamed().join(', '), units + ' units: ' + named.join(', ') + (units > named.length ? ' … (' + (units - named.length) + ' more)' : '')]).filter(Boolean).join('  ·  ') || fileName;

    var facts = Core.clear($('#dn-facts'));
    var list = [units + (units === 1 ? ' unit' : ' units'), shown + (shown === 1 ? ' row' : ' rows')];
    if (shown < total) list.push((total - shown) + ' datasheet rows left out by the row mapping');
    var differ = grid.rows.filter(function (r) { return r.marks && r.marks.some(Boolean); }).length;
    if (units > 1) list.push(differ ? differ + (differ === 1 ? ' row differs' : ' rows differ') + ' from ' + grid.columns[0] : 'All units match ' + grid.columns[0]);
    $('#dn-diff').hidden = units < 2;
    $('#dn-diff-text').textContent = grid.columns[0] + ' is taken as the reference. In each row, a value that differs from it is highlighted, with one colour for each different value. The same value in a row always has the same colour; after 5 different values the colours start again.';
    $('#dn-only-wrap').hidden = !differ;
    if (!differ) $('#dn-only').checked = false;
    list.forEach(function (t) { facts.appendChild(el('span', { class: 'badge', text: t })); });

    // one line per distinct point, naming the units it concerns (every unit = no names)
    var notes = [], byText = {}, order = [];
    parsed.forEach(function (u, i) {
      var r = DSParse.readers[u.type] || DSParse.readers.ahu, items = u.warnings.slice();
      if (!u.unit.rows.length) items.push('No "' + r.unitBlock + '" block was found on the datasheet.');
      if (!u.sections.length) items.push('No ' + r.sectionsName + ' were found on the datasheet.');
      items.forEach(function (w) {
        if (!byText[w]) { byText[w] = []; order.push(w); }
        byText[w].push(grid.columns[i]);
      });
    });
    order.forEach(function (w) {
      var who = byText[w];
      if (units === 1 || who.length === units) notes.push(w);
      else notes.push(who.slice(0, 5).join(', ') + (who.length > 5 ? ' and ' + (who.length - 5) + ' more' : '') + ': ' + w);
    });
    // files of this run that could not be read: the table is for the others
    var bad = Core.clear($('#dn-failed')); bad.hidden = !failed.length;
    if (failed.length) {
      bad.appendChild(el('strong', { text: failed.length === 1 ? '1 file was not read. The table is for the other files.' : failed.length + ' files were not read. The table is for the other files.' }));
      bad.appendChild(el('ul', { class: 'dn-list' }, failed.map(function (n) { return el('li', { text: n }); })));
    }

    var warn = Core.clear($('#dn-warn')); warn.hidden = !notes.length;
    if (notes.length) {
      warn.appendChild(el('strong', { text: 'Check these points:' }));
      warn.appendChild(el('ul', { class: 'dn-list' }, notes.map(function (n) { return el('li', { text: n }); })));
    }

    // Section | Component | one column per unit tag | Remarks
    var table = $('#dn-table').querySelector('table'), cols = Core.clear($('#dn-cols')), head = Core.clear($('#dn-head-row'));
    var unitW = units === 1 ? 320 : units > 12 ? 160 : 220;
    var lead = narrow.matches ? [92, 116] : [170, 210];   // Section and Component stay in view, so they are kept slim on a phone
    lead.concat(grid.columns.map(function () { return unitW; }), [130]).forEach(function (w) { var col = el('col'); col.style.width = w + 'px'; cols.appendChild(col); });
    ['Section', 'Component'].concat(grid.columns, ['Remarks']).forEach(function (t, i) {
      head.appendChild(el('th', { text: t, class: i >= 2 && i < 2 + units ? 'unit' : null }));
    });
    table.style.minWidth = (lead[0] + lead[1] + 130 + unitW * units) + 'px';

    var body = $('#dn-body'), frag = document.createDocumentFragment();
    onScreen().forEach(function (r) {
      var cls = (r.kind === 'sub' ? 'sub' : '') + (r.section ? ' first' : '') + (r.marks && r.marks.some(Boolean) ? ' differs' : '');
      frag.appendChild(el('tr', { class: cls.trim() || null },
        el('td', { class: 'sec', text: r.section }), el('td', { text: r.component }),
        r.cells.map(function (v, u) {
          var mk = r.marks ? r.marks[u] : 0;
          return el('td', { text: v, class: mk ? 'diff d' + ((mk - 1) % 5 + 1) : null, title: mk ? 'Differs from ' + grid.columns[0] : null });
        }), el('td')));
    });
    Core.clear(body).appendChild(frag);
    $('#dn-table').hidden = !grid.rows.length;
    $('#dn-empty').hidden = !!grid.rows.length;
    $('#dn-download').disabled = !grid.rows.length;
    result.hidden = false;
    pinColumns();
  }

  /* Component is pinned beside Section: it needs the width Section was given (the columns stretch on a wide screen). */
  function pinColumns() {
    var first = $('#dn-head-row').firstChild;
    if (first && !result.hidden) $('#dn-table').style.setProperty('--dn-c1', first.offsetWidth + 'px');
  }
  function onNarrow() { if (parsed && !result.hidden) render(); }

  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }

  /* ---------- start ---------- */
  Core.requireLogin({ tile: PR.TILE }).then(function () {
    productSel = $('#dn-product'); hint = $('#dn-scope-hint'); upload = $('#dn-upload'); result = $('#dn-result');
    drop = $('#dn-drop'); fileInput = $('#dn-file'); status = $('#dn-status'); mapNote = $('#dn-map-note');
    var id = Core.param('project');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      Core.showState('No project was chosen', 'Open a project and press "Read a datasheet" there.', { href: '/projects/', label: 'All projects' });
      return;
    }
    $('#back').href = '/projects/project.html?id=' + encodeURIComponent(id);
    PR.loading($('#loading'), 'Loading the project');

    productSel.addEventListener('change', function () {
      var p = product();
      if (busy) stop();
      clearResult();
      loadMapping(p && canRead(p) ? p.id : ''); applyGate();
    });
    drop.addEventListener('click', function () { if (!busy) fileInput.click(); });
    fileInput.addEventListener('change', function () { if (fileInput.files.length) read([].slice.call(fileInput.files)); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files;
      if (f && f.length && !busy) read([].slice.call(f));
    });
    // a PDF dropped beside the box must not replace the page
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    $('#dn-cancel').addEventListener('click', function () { if (busy) { stop(); drop.focus(); } });
    window.addEventListener('resize', pinColumns);
    if (narrow.addEventListener) narrow.addEventListener('change', onNarrow); else if (narrow.addListener) narrow.addListener(onNarrow);
    $('#dn-only').addEventListener('change', render);
    $('#dn-clear').addEventListener('click', function () { clearResult(); drop.focus(); });
    $('#dn-download').addEventListener('click', function () {
      if (!grid || !grid.rows.length) return;
      var name = grid.columns.length === 1 ? grid.columns[0] : (projectsNamed()[0] || fileName.replace(/\.pdf$/i, '')) + ' - ' + grid.columns.length + ' units';
      PRXlsx.save(DSXlsx.build(grid, 'Datasheet Notes'), (safeName(name) || 'Datasheet') + ' - Datasheet Notes.xlsx');
      Core.toast('Excel downloaded', 'success');
    });

    return Promise.all([Api.rpc('projects_get', { p_id: id }), Api.rpc('projects_products')]).then(function (res) {
      project = res[0]; products = res[1] || [];
      Core.setTitle('Read a datasheet - ' + project.code);
      $('#intro').textContent = 'Project ' + project.code + ' · ' + project.name + ' · ' + project.region + '. The PDF is read on your device; the table is saved in this project.';
      Core.clear(productSel);
      productSel.appendChild(option('', 'Choose a product'));
      products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
      productSel.disabled = false;
      if (products.length === 1) productSel.value = products[0].id;
      // the product of the last datasheet read into this project comes pre-selected
      if (!productSel.value && project.notes && project.notes.length) productSel.value = project.notes[0].product_id;
      if (product()) loadMapping(canRead(product()) ? product().id : '');
      $('#loading').hidden = true; $('#body').hidden = false;
      applyGate();
    }, function (err) {
      if (err && err.code === 'NOT_FOUND') Core.showState('Project not found', 'There is no project with this id.', { href: '/projects/', label: 'All projects' });
      else { $('#loading').hidden = false; PR.errorBox($('#loading'), err); }
    });
  });
})();
