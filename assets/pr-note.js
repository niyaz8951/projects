/* Projects tile - one saved datasheet table (the old tools/projects/note.html, brought over 2026-11-05): find, only the
   rows that differ, Download Excel. The row-name button that shows what the factory offers comes with Product Options (step 5). */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;
  var note = null, narrow = window.matchMedia('(max-width: 560px)');

  function bare(name) { return String(name || '').split(', ').map(function (n) { return n.replace(/\.[A-Za-z0-9]{1,5}$/, ''); }).join(', ') || 'Datasheet'; }
  function differs(r) { return !!(r.marks && r.marks.some(Boolean)); }

  function draw() {
    var q = $('#q').value.trim().toLowerCase(), only = $('#only').checked, units = note.columns.length;
    var unitW = units === 1 ? 320 : units > 12 ? 160 : 220, lead = narrow.matches ? [92, 116] : [170, 210];
    var cols = Core.clear($('#cols')), head = Core.clear($('#head-row'));
    lead.concat(note.columns.map(function () { return unitW; })).forEach(function (w) { var col = el('col'); col.style.width = w + 'px'; cols.appendChild(col); });
    ['Section', 'Component'].concat(note.columns).forEach(function (t, i) { head.appendChild(el('th', { text: t, class: i >= 2 ? 'unit' : null })); });
    $('#table').style.minWidth = (lead[0] + lead[1] + unitW * units) + 'px';
    $('#wrap').style.setProperty('--dn-c1', lead[0] + 'px');

    // headings (section name, sub-heading) move to the first row that is kept
    var frag = document.createDocumentFragment(), sec = '', secDone = true, sub = null, n = 0;
    note.rows.forEach(function (r) {
      if (r.section) { sec = r.section; secDone = false; sub = null; }
      if (r.kind === 'sub') { sub = r; return; }
      if (only && !differs(r)) return;
      if (q && (sec + ' ' + r.component + ' ' + (r.cells || []).join(' ')).toLowerCase().indexOf(q) < 0) return;
      if (sub) {
        frag.appendChild(el('tr', { class: 'sub' + (secDone ? '' : ' first') }, el('td', { class: 'sec', text: secDone ? '' : sec }), el('td', { text: sub.component }),
          note.columns.map(function () { return el('td'); })));
        secDone = true; sub = null;
      }
      frag.appendChild(el('tr', { class: secDone ? null : 'first' }, el('td', { class: 'sec', text: secDone ? '' : sec }), el('td', { text: r.component }),
        (r.cells || []).map(function (v, u) {
          var mk = r.marks ? r.marks[u] : 0;
          return el('td', { text: v, class: mk ? 'diff d' + ((mk - 1) % 5 + 1) : null, title: mk ? 'Differs from ' + note.columns[0] : null });
        })));
      secDone = true; n++;
    });
    Core.clear($('#rows')).appendChild(frag);
    $('#wrap').hidden = !n; $('#empty').hidden = !!n;
  }

  Core.requireLogin({ tile: PR.TILE }).then(function () {
    var id = Core.param('id'), timer;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      Core.showState('Table not found', 'This link does not point at a saved table.', { href: '/projects/', label: 'All projects' });
      return;
    }
    PR.loading($('#loading'), 'Loading the table');
    $('#q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(draw, 200); });
    $('#only').addEventListener('change', draw);
    if (narrow.addEventListener) narrow.addEventListener('change', function () { if (note) draw(); });
    $('#download').addEventListener('click', function () {
      var name = note.columns.length === 1 ? note.columns[0] : note.project + ' - ' + note.columns.length + ' units';
      PRXlsx.save(DSXlsx.build({ columns: note.columns, rows: note.rows }, 'Datasheet Notes'), name + ' - Datasheet Notes.xlsx');
      Core.toast('Excel downloaded', 'success');
    });
    Api.rpc('projects_note_get', { p_id: id }).then(function (res) {
      note = res;
      $('#back').href = '/projects/project.html?id=' + encodeURIComponent(note.project_id);
      var units = note.columns.length, rows = note.rows.filter(function (r) { return r.kind !== 'sub'; }), diff = rows.filter(differs).length;
      Core.setTitle(bare(note.file_names) + ' - ' + note.code);
      $('#name').textContent = bare(note.file_names);
      var facts = $('#facts');
      [note.code + ' ' + note.project, note.product + (note.factory ? ' · ' + note.factory + ' factory' : ''), units + (units === 1 ? ' unit' : ' units'), rows.length + (rows.length === 1 ? ' row' : ' rows'),
       'Read by @' + note.username + ', ' + Core.date(note.created_at)].forEach(function (t) { facts.appendChild(el('span', { class: 'badge', text: t })); });
      $('#only-wrap').hidden = !diff;
      if (units > 1) { $('#diff').hidden = false; $('#diff').textContent = note.columns[0] + ' is the reference. ' + (diff ? diff + (diff === 1 ? ' row differs' : ' rows differ') + ' from it; those cells are highlighted.' : 'All units match it.'); }
      $('#loading').hidden = true; $('#body').hidden = false; $('#download').hidden = false;
      draw();
    }).catch(function (err) {
      if (err && err.code === 'NOT_FOUND') Core.showState('Table not found', 'There is no saved table with this id, or it is in a project you cannot open.', { href: '/projects/', label: 'All projects' });
      else { PR.errorBox($('#loading'), err); }
    });
  });
})();
