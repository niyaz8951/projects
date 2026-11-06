/* Projects tile, shared by its pages: the project details form (create and edit) and small helpers. */
window.PR = (function () {
  'use strict';
  var el = Core.el;
  var PR = { TILE: 'projects' };

  // Levels (015, the core's access model): contribute creates projects; in one project, what he may do comes from the
  // project itself (projects_get: can_edit, can_share). Approve opens the knowledge base. The database decides; these only show and hide.
  function atLeast(me, level) { return !!me && (me.is_super || Core.levelRank(me.level) >= Core.levelRank(level)); }
  PR.canEdit = function (me) { return atLeast(me, 'contribute'); };
  PR.canReview = function (me) { return atLeast(me, 'approve'); };
  PR.isManager = function (me) { return atLeast(me, 'manage'); };

  function fillSelect(select, values, first) {
    Core.clear(select);
    select.appendChild(el('option', { value: '', text: first }));
    (values || []).forEach(function (v) { select.appendChild(el('option', { value: v, text: v })); });
  }
  PR.fillSelect = fillSelect;

  // Loads the pick lists once per page.
  var listsPromise = null;
  PR.lists = function () {
    if (!listsPromise) listsPromise = Api.rpc('projects_lists').catch(function (e) { listsPromise = null; throw e; });
    return listsPromise;
  };

  // Opens the details form in a sheet. opts: { title, ok, values: { name, client_type, client_name, region }, save: fn(values) -> promise }
  // Resolves with the result of save, or null when cancelled.
  PR.detailsSheet = function (opts) {
    return PR.lists().then(function (lists) {
      var v = opts.values || {};
      var fName = el('input', { id: 'pr-name', maxlength: '120', autocomplete: 'off', value: v.name || '' });
      var fType = el('select', { id: 'pr-type' });
      var fClient = el('input', { id: 'pr-client', maxlength: '120', autocomplete: 'off', value: v.client_name || '' });
      var fRegion = el('select', { id: 'pr-region' });
      fillSelect(fType, lists.client_types, 'Choose a client type');
      fillSelect(fRegion, lists.regions, 'Choose a region');
      fType.value = v.client_type || '';
      fRegion.value = v.region || '';
      var err = el('p', { class: 'notice danger', hidden: true });
      var form = el('form', { class: 'pr-form', novalidate: true },
        el('div', { class: 'field' }, el('label', { for: 'pr-name', text: 'Project name' }), fName),
        el('div', { class: 'field' }, el('label', { for: 'pr-type', text: 'Client type' }), fType),
        el('div', { class: 'field' }, el('label', { for: 'pr-client', text: 'Client name' }), fClient),
        el('div', { class: 'field' }, el('label', { for: 'pr-region', text: 'Region' }), fRegion),
        err);
      var saving = false;
      function submit() {
        if (saving) return false;
        var values = { name: fName.value.trim(), client_type: fType.value, client_name: fClient.value.trim(), region: fRegion.value };
        var miss = !values.name ? ['Enter a project name.', fName] : !values.client_type ? ['Choose a client type.', fType]
                 : !values.client_name ? ['Enter a client name.', fClient] : !values.region ? ['Choose a region.', fRegion] : null;
        err.hidden = true;
        if (miss) { err.textContent = miss[0]; err.hidden = false; miss[1].focus(); return false; }
        saving = true;
        return Promise.resolve(opts.save(values)).then(function (r) { saving = false; return r === undefined ? true : r; },
          function (e) { saving = false; err.textContent = Api.errorMessage(e); err.hidden = false; return false; });
      }
      // Enter in a text field acts like the primary button of the sheet.
      var okButton = null;
      form.appendChild(el('button', { type: 'submit', class: 'pr-hidden-submit', tabindex: '-1', 'aria-hidden': 'true' }));
      form.addEventListener('submit', function (e) { e.preventDefault(); if (okButton) okButton.click(); });
      return Core.sheet({ title: opts.title, body: form, modal: true,
        actions: [{ label: 'Cancel', value: null }, { label: opts.ok || 'Save', kind: 'primary', onClick: submit }],
        onOpen: function (box) { okButton = box.querySelector('.actions button.primary'); fName.focus(); } });
    });
  };

  // A tool that comes in a later step: one sheet saying so, in the place the tool will sit.
  PR.soon = function (title, step, text) {
    return Core.sheet({ title: title, modal: true,
      body: el('div', { class: 'pr-soon' }, el('p', { class: 'notice accent', text: 'Coming in step ' + step }), el('p', { text: text })),
      actions: [{ label: 'Close', kind: 'primary', value: true }] });
  };
  PR.readOnly = function () { Core.toast('You can read this project; you cannot add to it.'); };
  // The page that adds to a project (a datasheet, a specification) for someone who may only read it.
  PR.viewOnly = function (project) {
    Core.showState('You can read this project only', 'It is shared with you to view, so nothing can be added to it. Its owner can share it with you to edit.',
      { href: '/projects/project.html?id=' + encodeURIComponent(project.id), label: 'Back to the project' });
  };
  // Who may open a project, in one line, from projects_get / projects_list: { owner_name, mine, everyone, shared }.
  PR.accessLine = function (a) {
    a = a || {};
    var n = a.shared || 0, list = n + (n === 1 ? ' person or group' : ' people or groups');
    if (a.everyone === 'edit') return 'Everyone in Projects can open it and work in it.';
    if (a.everyone === 'read') return 'Everyone in Projects can open it to read' + (n ? '; ' + list + ' listed in Access.' : '.');
    var owner = a.mine ? 'You' : (a.owner_name || 'Its owner');
    return n ? owner + ', the tile\'s managers and ' + list + ' can open it.' : 'Only ' + (a.mine ? 'you' : owner) + ' and the tile\'s managers can open it.';
  };

  // Plain error state inside a host element.
  PR.errorBox = function (host, err) {
    Core.clear(host);
    host.appendChild(el('p', { class: 'notice danger', text: Api.errorMessage(err) }));
  };

  // Loading placeholder inside a host element.
  PR.loading = function (host, text) {
    Core.clear(host);
    host.appendChild(el('div', { class: 'loading-veil' }, el('span', { class: 'spin' }), text || 'Loading'));
  };

  return PR;
})();
