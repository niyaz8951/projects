/* Projects tile, the register: find, filter, list, create. Guard first; the database decides what is allowed. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el;

  Core.requireLogin({ tile: PR.TILE }).then(function (me) {
    var canEdit = PR.canEdit(me);
    var rows = [];
    var seesAll = !!(me.tile_admin || me.is_super); // a tile admin or the super user sees every project; the database confirms it per answer
    var timer = null;
    var seq = 0;

    $('#new').hidden = !canEdit;
    // the knowledge base: Compliance review and Product Options, for the reviewers (tile admins and the super user; the database decides)
    var canReview = !!(me.is_super || me.tile_admin || (me.rights || []).indexOf('review') >= 0);
    $('#review').hidden = !canReview; $('#options').hidden = !canReview;
    $('#review').addEventListener('click', function () { Core.go('/projects/library.html'); });
    $('#options').addEventListener('click', function () {
      PR.soon('Product Options', 5, 'What each factory has offered so far, per product and factory: the values collected from every datasheet read (waiting for approval), special options, hidden values and the row mapping. Comes in step 5. The values are already being collected from the datasheets read in step 2.');
    });
    function intro() {
      $('#intro').textContent = 'A project holds the specifications and datasheets of one job. '
        + (seesAll ? 'You see every project of the team.' : 'You see your projects and the projects shared with you.');
    }
    intro();

    // filters
    PR.lists().then(function (lists) {
      PR.fillSelect($('#f-region'), lists.regions, 'All regions');
      PR.fillSelect($('#f-type'), lists.client_types, 'All client types');
    }).catch(function (err) { Core.showError(err); });

    function filters() {
      return { p_q: $('#q').value.trim() || null, p_region: $('#f-region').value || null, p_client_type: $('#f-type').value || null };
    }
    function filtered() { var f = filters(); return !!(f.p_q || f.p_region || f.p_client_type); }

    function open(id) { Core.go('/projects/project.html?id=' + encodeURIComponent(id)); }

    function render() {
      var host = $('#list'); Core.clear(host);
      var total = rows.length ? rows[0].total : 0;
      $('#download').hidden = !rows.length;
      // find and filters only once there is something to find in (the screen map: search when there are 2 or more)
      $('#filters').hidden = !filtered() && total < 2;
      if (!rows.length) {
        $('#count').textContent = '';
        var box = el('div', { class: 'state' },
          el('h2', { text: filtered() ? 'No project matches' : 'No projects yet' }),
          el('p', { text: filtered() ? 'Nothing in the list fits this search and these filters.'
                                     : 'A project holds the specifications and datasheets of one job. '
                                       + (canEdit ? 'Start one to read its datasheet and convert its specification.' : 'Projects appear here once a colleague creates or shares one with you.') }),
          filtered() ? el('button', { class: 'btn', type: 'button', text: 'Clear filters', on: { click: function () {
              $('#q').value = ''; $('#f-region').value = ''; $('#f-type').value = ''; load(); } } })
            : canEdit ? el('button', { class: 'btn primary', type: 'button', text: 'New project', on: { click: create } }) : null);
        host.appendChild(box);
        return;
      }
      $('#count').textContent = rows.length < total
        ? 'First ' + rows.length + ' of ' + total + ' projects - narrow the search to see the rest'
        : total + (total === 1 ? ' project' : ' projects') + (filtered() ? ' match' : '');
      var tbody = el('tbody');
      rows.forEach(function (p) {
        var tr = el('tr', { tabindex: '0', role: 'link', 'aria-label': 'Open ' + p.name, on: {
          click: function () { open(p.id); },
          keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p.id); } } } },
          el('td', null, el('span', { class: 'name', text: p.name }),
            !seesAll && p.created_by_name !== me.username ? el('span', { class: 'badge accent', text: 'shared with you' }) : null,
            el('span', { class: 'sub code', text: p.code })),
          el('td', { 'data-label': 'Client' }, p.client_name, el('span', { class: 'sub', text: p.client_type })),
          el('td', { 'data-label': 'Region', text: p.region }),
          el('td', { 'data-label': 'Saved' }, el('div', { class: 'chips pr-saved' },
            p.runs ? el('span', { class: 'badge', text: p.runs + (p.runs === 1 ? ' compliance sheet' : ' compliance sheets') }) : null,
            p.notes ? el('span', { class: 'badge', text: p.notes + (p.notes === 1 ? ' datasheet table' : ' datasheet tables') }) : null,
            p.pending ? el('span', { class: 'badge warning', text: p.pending + ' in review' }) : null,
            !p.runs && !p.notes ? el('span', { class: 'sub', text: 'Nothing saved yet' }) : null)),
          seesAll ? el('td', { 'data-label': 'Created by', text: p.created_by_name }) : null,
          el('td', { 'data-label': 'Last changed', text: Core.date(p.updated_at) }));
        tbody.appendChild(tr);
      });
      host.appendChild(el('div', { class: 'table-wrap' },
        el('table', { class: 'pr-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Project' }), el('th', { text: 'Client' }), el('th', { text: 'Region' }), el('th', { text: 'Saved' }),
            seesAll ? el('th', { text: 'Created by' }) : null, el('th', { text: 'Last changed' }))),
          tbody)));
    }

    function load() {
      var my = ++seq;
      PR.loading($('#list'), 'Loading projects');
      return Api.rpc('projects_list', filters()).then(function (r) {
        if (my !== seq) return; // an older answer arriving late
        rows = r || [];
        if (rows.length && rows[0].sees_all !== undefined) seesAll = !!rows[0].sees_all; // the database's answer wins
        intro(); render();
      }).catch(function (err) { if (my === seq) { $('#count').textContent = ''; PR.errorBox($('#list'), err); } });
    }
    load();

    $('#q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 250); });
    $('#f-region').addEventListener('change', load);
    $('#f-type').addEventListener('change', load);

    // create
    function create() {
      PR.detailsSheet({ title: 'New project', ok: 'Create project', save: function (v) {
        return Api.rpc('projects_create', { p_name: v.name, p_client_type: v.client_type, p_client_name: v.client_name, p_region: v.region });
      } }).then(function (r) {
        if (!r || !r.id) return;
        Core.toast('Project ' + r.code + ' created', 'success');
        open(r.id);
      }).catch(Core.showError);
    }
    $('#new').addEventListener('click', create);

    // download the shown rows as a CSV built here in the browser
    function csvCell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    $('#download').addEventListener('click', function () {
      var lines = [['Code', 'Project', 'Client type', 'Client name', 'Region', 'Created by', 'Created', 'Compliance sheets', 'Datasheet tables', 'Answers in review', 'Last changed']];
      rows.forEach(function (p) { lines.push([p.code, p.name, p.client_type, p.client_name, p.region, p.created_by_name, Core.date(p.created_at), p.runs || 0, p.notes || 0, p.pending || 0, Core.date(p.updated_at)]); });
      var text = '﻿' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\r\n') + '\r\n';
      Core.download('projects.csv', new Blob([text], { type: 'text/csv;charset=utf-8' }));
    });
  });
})();
