/* Projects tile, one project: the next step, what it holds, details, sharing, history. Guard first; the database decides. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;

  Core.requireLogin({ tile: PR.TILE }).then(function (me) {
    var canEdit = PR.canEdit(me);
    var id = Core.param('id');
    var data = null;

    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      Core.showState('Project not found', 'This link does not point at a project.', { href: '/projects/', label: 'All projects' });
      return;
    }

    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    /* Where each tool button leads. */
    var readSheet = '/projects/datasheet.html?project=' + encodeURIComponent(id);
    var addSpec = '/projects/add-spec.html?project=' + encodeURIComponent(id);
    function go(key) { Core.go(key === 'datasheet' ? readSheet : addSpec); }
    function bareName(name) { return String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, ''); }
    function bareNames(names) { return String(names || '').split(', ').map(bareName).join(', '); }

    /* The one thing to do next, worked out from what the project holds (step 1: nothing yet, so the datasheet comes first). */
    function nextStep() {
      var runs = data.runs || [], notes = data.notes || [], clauses = 0, filled = 0, pending = 0;
      runs.forEach(function (r) { clauses += r.clauses || 0; filled += r.filled || 0; pending += r.pending || 0; });
      var open = runs.filter(function (r) { return (r.clauses || 0) > (r.filled || 0); }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })[0];
      var eyebrow = 'Next step', title, sub, acts = [];
      // datasheet work in green, specification work in orange (owner, 2026-11-06), the rest in the tile's colour
      function act(text, key, ghost) {
        var hue = key === 'datasheet' ? 'green' : key === 'spec' || /^record:/.test(key) ? 'orange' : null;
        acts.push(el('button', { type: 'button', class: 'btn' + (ghost ? (hue ? ' pr-soft' : '') : ' primary'), 'data-accent': hue, text: text, on: { click: function () {
          if (key === 'download') { $('#export').click(); return; }
          if (/^record:/.test(key)) { Core.go('/projects/record.html?run=' + encodeURIComponent(key.slice(7))); return; }
          go(key);
        } } }));
      }
      if (!runs.length && !notes.length) {
        eyebrow = 'Step 1 of 2 (optional)';
        title = 'Read the datasheet first';
        sub = 'Read the selection datasheet before the specification: the clauses are then compared with the selected units’ values. No datasheet yet? Add the specification: the clauses get the closest values the factory offers (Product Options) and the Excel lists what to select.';
        if (canEdit) { act('Read a datasheet', 'datasheet'); act('Add a specification without a datasheet', 'spec', true); }
      } else if (open) {
        var left = open.clauses - open.filled;
        title = (open.filled ? 'Continue ' : 'Fill ') + (bareName(open.file_name) || 'the specification');
        sub = plural(left, 'clause is', 'clauses are') + ' still open.' + (!open.filled && open.from_library ? ' ' + open.from_library + ' came answered from the library.' : '');
        act(open.filled ? 'Continue filling' : 'Start filling', 'record:' + open.id);
      } else if (runs.length && !notes.some(function (n) { return runs.some(function (r) { return r.product_id === n.product_id; }); })) {
        title = 'Read the datasheet'; sub = 'Every clause is filled. Read the datasheet to put what the units have beside what the specification asks.';
        if (canEdit) act('Read a datasheet', 'datasheet');
        act('Download project (Excel)', 'download', true);
      } else if (!runs.length) {
        eyebrow = 'Step 2 of 2';
        title = 'Add the specification';
        sub = 'The datasheet is in. Add the specification: its clauses are compared with the units’ values.';
        if (canEdit) act('Add a specification', 'spec');
      } else {
        eyebrow = 'Up to date'; title = 'Everything is answered';
        sub = pending ? plural(pending, 'answer is', 'answers are') + ' with the reviewers for the library. You can download the project now.' : 'Download the project, or add another specification or datasheet.';
        act('Download project (Excel)', 'download');
      }
      $('#meter').hidden = !clauses;
      if (clauses) {
        $('#meter-bar').style.width = Math.round(100 * filled / clauses) + '%';
        $('#meter-text').textContent = filled + ' of ' + clauses + ' clauses answered' + (pending ? ', ' + pending + ' waiting for review' : '') + '.';
      }
      $('#next-eyebrow').textContent = eyebrow; $('#next-title').textContent = title; $('#next-sub').textContent = sub;
      var box = Core.clear($('#next-actions')); acts.forEach(function (a) { box.appendChild(a); });
      // on a phone the primary action is docked at the bottom
      var dock = Core.clear($('#dock')); dock.hidden = !acts.length;
      if (acts.length) dock.appendChild(el('button', { type: 'button', class: 'btn primary block', 'data-accent': acts[0].getAttribute('data-accent'), text: acts[0].textContent, on: { click: function () { acts[0].click(); } } }));
    }

    function toolTile(name, text, icon, n, one, many, key) {
      return el('a', { class: 'tile pr-tile ' + (n ? 'has' : 'none'), href: key === 'datasheet' ? readSheet : addSpec, 'aria-label': name, 'data-accent': key === 'datasheet' ? 'green' : 'orange',
                       on: { click: function (e) { if (!canEdit) { e.preventDefault(); PR.readOnly(); } } } },
        el('span', { class: 'icon i-' + icon }),
        el('span', null, el('span', { class: 'name', text: name }), el('span', { class: 'tagline', text: text }),
          el('span', { class: 'flag muted', text: n ? plural(n, one, many) + ' saved' : 'Nothing saved yet' })));
    }

    function emptyState(host, title, text, button, key) {
      Core.clear(host).appendChild(el('div', { class: 'state tight' }, el('h3', { text: title }), el('p', { text: text }),
        canEdit ? el('button', { type: 'button', class: 'btn primary', text: button, on: { click: function () { go(key); } } }) : null));
    }

    function bare(names) { return String(names || '').split(', ').map(function (n) { return n.replace(/\.[A-Za-z0-9]{1,5}$/, ''); }).join(', '); }

    /* The datasheet tables of the project: view, Download Excel, Remove (right edit). */
    function noteRow(n) {
      var view = '/projects/note.html?id=' + encodeURIComponent(n.id);
      return el('tr', null,
        el('td', null, el('a', { class: 'name', href: view, title: 'View the table', text: bare(n.file_names) || 'Datasheet' }),
          el('span', { class: 'sub', text: Core.dateTime(n.created_at) })),
        el('td', { 'data-label': 'Product', text: n.product + (n.factory ? ' \u00b7 ' + n.factory : '') }),
        el('td', { 'data-label': 'Size', text: plural(n.units, 'unit', 'units') + ', ' + plural(n.rows, 'row', 'rows') }),
        el('td', { 'data-label': 'By', text: '@' + n.username }),
        el('td', { class: 'act' },
          el('a', { class: 'btn small primary', href: view, text: 'View' }),
          el('button', { type: 'button', class: 'btn small ghost', text: 'Download Excel', on: { click: function (e) {
            var b = e.currentTarget; b.disabled = true;
            Api.rpc('projects_note_get', { p_id: n.id }).then(function (t) {
              var name = t.columns.length === 1 ? t.columns[0] : data.name + ' - ' + t.columns.length + ' units';
              PRXlsx.save(DSXlsx.build({ columns: t.columns, rows: t.rows }, 'Datasheet Notes'), name + ' - Datasheet Notes.xlsx');
              Core.toast('Excel downloaded', 'success');
            }).catch(Core.showError).then(function () { b.disabled = false; });
          } } }),
          canEdit ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove', on: { click: function () {
            Core.confirm('This cannot be undone. Read the datasheet again to get the table back.', { ok: 'Remove', danger: true }).then(function (yes) {
              if (!yes) return;
              return Api.rpc('projects_note_delete', { p_id: n.id }).then(function () { Core.toast('Table removed', 'success'); load(); });
            }).catch(Core.showError);
          } } }) : null));
    }

    function share(r, n) { return r.clauses ? Math.round(100 * n / r.clauses) : 0; }
    function runRow(r) {
      var open = '/projects/record.html?run=' + encodeURIComponent(r.id);
      var badges = el('div', { class: 'chips' },
        r.from_library ? el('span', { class: 'badge', text: r.from_library + ' from the library' }) : null,
        r.answered ? el('span', { class: 'badge success', text: r.answered + ' filled by the project' }) : null,
        r.pending ? el('span', { class: 'badge warning', text: r.pending + ' in review' }) : null,
        r.approved ? el('span', { class: 'badge success', text: r.approved + ' approved' }) : null,
        r.rejected ? el('span', { class: 'badge', text: r.rejected + ' not taken' }) : null,
        !r.from_library && !r.answered ? el('span', { class: 'muted', text: 'Not filled yet' }) : null);
      var bar = el('div', { class: 'progress pr-meter' }, el('span')); bar.firstChild.style.width = share(r, r.filled || 0) + '%';
      return el('tr', null,
        el('td', null, el('a', { class: 'name', href: open, title: 'Read and fill online', text: bareName(r.file_name) || 'Pasted text' }),
          el('span', { class: 'sub', text: r.factory + ' factory \u00b7 ' + Core.dateTime(r.created_at) })),
        el('td', { 'data-label': 'Answered' }, bar, el('span', { class: 'sub', text: (r.filled || 0) + ' of ' + (r.clauses || 0) + ' answered' })),
        el('td', null, badges),
        el('td', { 'data-label': 'By', text: '@' + r.user }),
        el('td', { class: 'act' },
          el('a', { class: 'btn small primary', href: open, text: 'Open' }),
          canEdit ? el('button', { type: 'button', class: 'btn small ghost', text: 'Upload filled Excel', on: { click: function () { uploadFor = r; $('#file').click(); } } }) : null,
          canEdit ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove', on: { click: function () {
            Core.confirm('Its clauses stay in the factory library. The answers you filled for this project go with the record.', { ok: 'Remove', danger: true }).then(function (yes) {
              if (!yes) return;
              return Api.rpc('projects_run_delete', { p_run_id: r.id }).then(function () { Core.toast('Record removed', 'success'); load(); });
            }).catch(Core.showError);
          } } }) : null));
    }

    /* A filled compliance Excel: the Specifications / Compliance / Remarks columns are read and the answers saved on the matching rows. */
    var uploadFor = null;
    function readSheet(rows) {
      var head = -1, cs = -1, cc = -1, cr = -1;
      for (var i = 0; i < Math.min(rows.length, 40) && head < 0; i++) {
        var s = -1, c = -1, r = -1;
        rows[i].forEach(function (v, k) {
          v = String(v == null ? '' : v).trim().toLowerCase();
          if (s < 0 && /^specifications?$/.test(v)) s = k; else if (c < 0 && /^compliance$/.test(v)) c = k; else if (r < 0 && /^remarks?$/.test(v)) r = k;
        });
        if (s >= 0 && c >= 0) { head = i; cs = s; cc = c; cr = r; }
      }
      if (head < 0) throw new Error('This sheet has no Specifications and Compliance column headings. Use the Excel downloaded from the record.');
      var out = [];
      rows.slice(head + 1).forEach(function (row) {
        var spec = String(row[cs] == null ? '' : row[cs]).trim(); if (!spec) return;
        var c = String(row[cc] == null ? '' : row[cc]).trim(), r = cr >= 0 ? String(row[cr] == null ? '' : row[cr]).trim() : '';
        if (c || r) out.push({ spec: spec, compliance: c, remarks: r });
      });
      return out;
    }
    function say(text, kind) { var m = $('#up-msg'); m.hidden = !text; m.className = 'notice' + (kind ? ' ' + kind : ''); m.textContent = text || ''; }
    $('#file').addEventListener('change', function () {
      var file = this.files[0], run = uploadFor; this.value = '';
      if (!file || !run) return;
      if (!/\.xlsx$/i.test(file.name)) { say('Please choose an .xlsx file. An older .xls file must be saved as .xlsx first.', 'danger'); return; }
      say('Reading ' + file.name + '\u2026');
      HubXlsx.read(file).then(function (rows) {
        var filled = readSheet(rows);
        if (!filled.length) throw new Error('No filled rows were found in ' + file.name + '. Fill in Compliance or Remarks for at least one row.');
        return Api.rpc('projects_run_submit_answers', { p_run_id: run.id, p_rows: filled });
      }).then(function (res) {
        say(res.stored ? plural(res.stored, 'answer', 'answers') + ' saved in this project from ' + file.name + '. ' +
            (res.pending ? plural(res.pending, 'is', 'are') + ' new or different from the library and waiting for review.' : 'All of them match the library already.')
          : 'Nothing changed: no filled row of ' + file.name + ' matches a clause of this record, or the answers were already saved.', res.stored ? 'success' : 'warning');
        return load();
      }).then(null, function (err) { say(Api.errorMessage(err), 'danger'); });
    });

    /* The whole project as one Excel: information, one Specs / Notes / Review sheet per product (the old pr_export flow). */
    $('#export').addEventListener('click', function () {
      var btn = $('#export'); btn.disabled = true;
      Api.rpc('projects_export', { p_project_id: id }).then(function (x) {
        var ids = {}, both = [];
        (data.runs || []).forEach(function (r) { ids[r.product_id] = (ids[r.product_id] || 0) | 1; });
        (data.notes || []).forEach(function (n) { ids[n.product_id] = (ids[n.product_id] || 0) | 2; });
        Object.keys(ids).forEach(function (k) { if (ids[k] === 3) both.push(k); });
        return Promise.all(both.map(function (k) { return PRMatch.load({ projectId: id, productId: k, detail: data }).then(null, function () { return null; }); }))
          .then(function (matches) { return { x: x, matches: matches.filter(Boolean) }; });
      }).then(function (got) {
        var x = got.x, review = {}, p = x.project;
        got.matches.forEach(function (m) { review[m.product] = m; });
        var info = [['Project information', ''], ['Project code', p.code || ''], ['Project name', p.name], ['Client type', p.client_type], ['Client name', p.client_name], ['Region', p.region],
          ['Created by', p.created_by], ['Created', Core.dateTime(p.created_at)], ['Last changed by', p.updated_by], ['Last changed', Core.dateTime(p.updated_at)],
          ['Compliance records', x.runs.length], ['Datasheet tables', x.tables.length], ['Downloaded', Core.dateTime(new Date().toISOString())]];
        var sheets = [{ name: 'Project Information', widths: [24, 60], rows: info }], products = [];
        x.runs.forEach(function (r) { if (products.indexOf(r.product) < 0) products.push(r.product); });
        x.tables.forEach(function (t) { if (products.indexOf(t.product) < 0) products.push(t.product); });
        products.sort().forEach(function (product) {
          var rows = [], bold = [], part = [], sect = [], first = true;
          x.runs.filter(function (r) { return r.product === product; }).reverse().forEach(function (r) {
            if (!first) rows.push([]); first = false;
            bold.push(rows.length); rows.push([bareName(r.file_name) || 'Pasted text', r.factory + ' factory, converted by @' + r.user + ', ' + Core.dateTime(r.created_at), '', '', '', '']);
            bold.push(rows.length); rows.push(['Sr', 'Specifications', 'Compliance', 'Remarks', 'Answer from', 'Filled by']);
            x.compliance.filter(function (c) { return c.run === r.id; }).forEach(function (c) {
              if (c.type === 'part') part.push(rows.length); else if (c.type === 'section') sect.push(rows.length);
              rows.push([c.sr, c.spec, c.compliance, c.remarks, c.source, c.by]);
            });
          });
          if (rows.length) sheets.push({ name: 'Specs-' + product, widths: [9, 90, 22, 44, 34, 20], rows: rows, bold: bold, part: part, sect: sect });
          var notes = [], nbold = [], width = 0;
          x.tables.filter(function (t) { return t.product === product; }).forEach(function (t) {
            if (notes.length) notes.push([]);
            nbold.push(notes.length); notes.push([bareNames(t.file_names) || 'Datasheet', Core.dateTime(t.created_at)]);
            nbold.push(notes.length); notes.push(['Section', 'Component'].concat(t.columns, ['Remarks']));
            width = Math.max(width, t.columns.length);
            var sec = '';
            t.rows.forEach(function (r) { if (r.section) sec = r.section; notes.push([sec, r.component].concat(r.cells || [], [''])); });
          });
          if (notes.length) {
            var widths = [24, 30]; for (var i = 0; i < width; i++) widths.push(28); widths.push(24);
            sheets.push({ name: 'Notes-' + product, widths: widths, rows: notes, bold: nbold });
          }
          var m = review[product], rv = m ? PRMatch.sheetRows(m, false) : [];
          if (rv.length) {
            var out = [['Section', 'Component', 'Specification asks'].concat(m.columns, ['Remarks'])], rsect = [];
            rv.forEach(function (r) {
              if (r.section) rsect.push(out.length);
              out.push([r.section, r.component, r.text].concat(r.kind === 'sub' ? m.columns.map(function () { return ''; }) : r.cells, ['']));
            });
            sheets.push({ name: 'Review-' + product, widths: [24, 30, 70].concat(m.columns.map(function () { return 26; }), [30]), rows: out, bold: [0], sect: rsect });
          }
        });
        PRXlsx.save(PRXlsx.build(sheets), p.code + ' ' + p.name + ' - project data.xlsx');
        Core.toast('Excel downloaded', 'success');
        return load();
      }).catch(Core.showError).then(function () { btn.disabled = false; });
    });

    function show() {
      Core.setTitle(data.code + ' ' + data.name);
      $('#name').textContent = data.name;
      $('#client').textContent = data.client_name + ' · ' + data.client_type + ' · ' + data.region;
      $('#code').textContent = data.code; $('#code').hidden = false;
      $('#edit').hidden = !canEdit;
      $('#loading').hidden = true; $('#body').hidden = false;

      nextStep();

      var notes = data.notes || [], runs = data.runs || [];
      var tiles = Core.clear($('#tiles'));
      tiles.appendChild(toolTile('1. Read a datasheet (optional)', 'Datasheet PDF in, one column per unit. Read it first: the specification is then filled from it.', 'notes', notes.length, 'datasheet table', 'datasheet tables', 'datasheet'));
      tiles.appendChild(toolTile('2. Add a specification', 'PDF or pasted text in, clauses ready to fill.', 'check', runs.length, 'specification', 'specifications', 'spec'));

      if (!notes.length) emptyState($('#notes'), 'No datasheet yet', 'Read the selection datasheet: one column per unit, and its values show beside the clauses that ask about them.', 'Read a datasheet', 'datasheet');
      else {
        var tbody = el('tbody'); notes.forEach(function (n) { tbody.appendChild(noteRow(n)); });
        Core.clear($('#notes')).appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'pr-table pr-notes' },
          el('thead', null, el('tr', null, el('th', { text: 'Datasheet' }), el('th', { text: 'Product' }), el('th', { text: 'Size' }), el('th', { text: 'By' }), el('th'))), tbody)));
        if (canEdit) $('#notes').appendChild(el('p', null, el('button', { type: 'button', class: 'btn small pr-soft', text: 'Read another datasheet', on: { click: function () { go('datasheet'); } } })));
      }
      if (!runs.length) emptyState($('#runs'), 'No specification yet', 'Add the PDF or paste the text: the clauses come ready to answer, with what the library already knows.', 'Add a specification', 'spec');
      else {
        var rbody = el('tbody'), products = [];
        runs.forEach(function (r) { if (products.indexOf(r.product) < 0) products.push(r.product); });
        products.sort().forEach(function (name) {
          var mine = runs.filter(function (r) { return r.product === name; });
          rbody.appendChild(el('tr', { class: 'pr-group' }, el('td', { colspan: '5', text: name + ' (' + plural(mine.length, 'record', 'records') + ')' })));
          mine.forEach(function (r) { rbody.appendChild(runRow(r)); });
        });
        Core.clear($('#runs')).appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'pr-table pr-notes pr-runs' },
          el('thead', null, el('tr', null, el('th', { text: 'Specification' }), el('th', { text: 'Answered' }), el('th', { text: 'Answers' }), el('th', { text: 'By' }), el('th'))), rbody)));
        if (canEdit) $('#runs').appendChild(el('p', null, el('button', { type: 'button', class: 'btn small pr-soft', text: 'Add another specification', on: { click: function () { go('spec'); } } })));
      }
      // products that have both a specification and a datasheet can be put side by side
      var both = [];
      runs.forEach(function (r) { if (notes.some(function (n) { return n.product_id === r.product_id; }) && !both.some(function (b) { return b.id === r.product_id; })) both.push({ id: r.product_id, name: r.product }); });
      var cmp = Core.clear($('#compare'));
      both.forEach(function (b) {
        cmp.appendChild(el('a', { class: 'btn', href: '/projects/compare.html?project=' + encodeURIComponent(id) + '&product=' + encodeURIComponent(b.id), text: b.name + ': specification beside datasheet' }));
      });
      $('#compare-card').hidden = !both.length;
      $('#export').hidden = !(runs.length || notes.length);

      var facts = el('dl', { class: 'pr-facts' });
      [['Code', data.code], ['Client', data.client_name], ['Client type', data.client_type], ['Region', data.region],
       ['Created', Core.dateTime(data.created_at) + ' by @' + data.created_by_name],
       ['Last changed', Core.dateTime(data.updated_at) + ' by @' + data.updated_by_name]].forEach(function (f) {
        facts.appendChild(el('dt', { text: f[0] })); facts.appendChild(el('dd', { text: f[1] }));
      });
      Core.clear($('#details')).appendChild(facts);

      $('#share').hidden = !data.can_share;
      var members = Core.clear($('#members'));
      if (!data.members.length) {
        members.appendChild(el('p', { class: 'muted', text: data.can_share
          ? 'Only @' + data.created_by_name + ' and the tile admins can open this project. Share it to let other people work in it.'
          : 'Only @' + data.created_by_name + ' and the tile admins can open this project.' }));
      } else {
        var ul = el('ul', { class: 'pr-members' });
        data.members.forEach(function (m) {
          ul.appendChild(el('li', null,
            el('span', { text: '@' + m.username + (m.display_name ? ' - ' + m.display_name : '') }),
            m.active ? null : el('span', { class: 'badge', text: 'disabled' }),
            el('span', { class: 'meta', text: 'added by @' + m.added_by_name + ' - ' + Core.date(m.added_at) })));
        });
        members.appendChild(ul);
        members.appendChild(el('p', { class: 'muted', text: 'They can see this project and work in it; they cannot share it on.' }));
      }

      var log = Core.clear($('#log'));
      if (!data.events.length) log.appendChild(el('li', { class: 'muted', text: 'Nothing has happened in this project yet.' }));
      data.events.forEach(function (e) {
        log.appendChild(el('li', null,
          el('span', { text: e.action }), e.detail ? el('span', { class: 'detail', text: ' - ' + e.detail }) : null,
          el('span', { class: 'meta', text: '@' + e.username + ' - ' + Core.dateTime(e.created_at) })));
      });
    }

    function load() {
      if (!data) PR.loading($('#loading'), 'Loading the project');
      return Api.rpc('projects_get', { p_id: id }).then(function (r) { data = r; show(); }).catch(function (err) {
        if (err && err.code === 'NOT_FOUND') Core.showState('Project not found', 'There is no project with this id.', { href: '/projects/', label: 'All projects' });
        else { $('#loading').hidden = false; PR.errorBox($('#loading'), err); }
      });
    }
    load();

    /* share: the whole list of people the project is shared with (tile admins and the super user; the database decides) */
    $('#share').addEventListener('click', function () {
      if (!data) return;
      Api.rpc('projects_share_get', { p_id: id }).then(function (s) {
        var picked = {};
        s.members.forEach(function (m) { picked[m.id] = m; });
        var people = s.users.slice();
        s.members.forEach(function (m) { if (!people.some(function (u) { return u.id === m.id; })) people.push(m); });
        people.sort(function (a, b) { return a.username.localeCompare(b.username); });

        var count = el('p', { class: 'muted' });
        function tally() {
          var n = Object.keys(picked).length;
          count.textContent = n ? 'Shared with ' + n + (n === 1 ? ' person' : ' people') + '. They can see this project and work in it; they cannot share it on.'
                               : 'Not shared. Only @' + s.created_by_name + ' and the tile admins can open this project.';
        }
        var find = el('input', { type: 'search', placeholder: 'Find a person', autocomplete: 'off', 'aria-label': 'Find a person' });
        var list = el('div', { class: 'pr-share-list' });
        function draw() {
          Core.clear(list);
          var q = find.value.trim().toLowerCase();
          var rows = people.filter(function (u) { return !q || u.username.indexOf(q) >= 0 || (u.display_name || '').toLowerCase().indexOf(q) >= 0; });
          if (!rows.length) {
            list.appendChild(el('p', { class: 'muted', text: people.length ? 'Nobody matches.'
              : s.core_missing ? 'The core cannot list the team yet, so nobody can be added here for now.' : 'There is nobody else with the tile to share with yet.' }));
          }
          rows.forEach(function (u) {
            var box = el('input', { type: 'checkbox', value: u.id, on: { change: function () { if (box.checked) picked[u.id] = u; else delete picked[u.id]; tally(); } } });
            box.checked = !!picked[u.id];
            list.appendChild(el('label', { class: 'check' }, box, '@' + u.username, u.display_name ? el('span', { class: 'sub', text: u.display_name }) : null,
              u.active === false ? el('span', { class: 'badge', text: 'disabled' }) : null));
          });
        }
        find.addEventListener('input', draw);
        draw(); tally();
        var err = el('p', { class: 'notice danger', hidden: true });
        var body = el('div', { class: 'pr-share' }, count, el('div', { class: 'field' }, find), list, err);
        return Core.sheet({ title: 'Share ' + data.name, body: body, modal: true,
          actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', onClick: function () {
            err.hidden = true;
            return Api.rpc('projects_share_set', { p_id: id, p_user_ids: Object.keys(picked) }).then(function (r) { return r; },
              function (e) { err.textContent = Api.errorMessage(e); err.hidden = false; return false; });
          } }],
          onOpen: function () { find.focus(); } });
      }).then(function (r) {
        if (r === null || r === undefined) return;
        Core.toast(r.members ? 'Shared with ' + r.members + (r.members === 1 ? ' person' : ' people') : 'Sharing ended', 'success');
        load();
      }).catch(Core.showError);
    });

    $('#edit').addEventListener('click', function () {
      if (!data) return;
      PR.detailsSheet({ title: 'Edit details', ok: 'Save', values: data, save: function (v) {
        return Api.rpc('projects_update', { p_id: id, p_name: v.name, p_client_type: v.client_type, p_client_name: v.client_name, p_region: v.region });
      } }).then(function (r) {
        if (r === null) return;
        Core.toast('Saved', 'success');
        load();
      }).catch(Core.showError);
    });
  });
})();
