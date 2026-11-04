/* Projects tile, one project: details, edit details, history. Guard first; the database decides. */
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

    function show() {
      Core.setTitle(data.code + ' ' + data.name);
      $('#name').textContent = data.name;
      $('#code').textContent = data.code; $('#code').hidden = false;
      $('#edit').hidden = !canEdit;

      var facts = el('dl', { class: 'pr-facts' });
      [['Code', data.code], ['Client', data.client_name], ['Client type', data.client_type], ['Region', data.region],
       ['Created', Core.dateTime(data.created_at) + ' by @' + data.created_by_name],
       ['Last changed', Core.dateTime(data.updated_at) + ' by @' + data.updated_by_name]].forEach(function (f) {
        facts.appendChild(el('dt', { text: f[0] })); facts.appendChild(el('dd', { text: f[1] }));
      });
      Core.clear($('#details')).appendChild(facts);

      var log = $('#log'); Core.clear(log);
      if (!data.events.length) log.appendChild(el('li', { class: 'muted', text: 'Nothing has happened in this project yet.' }));
      data.events.forEach(function (e) {
        log.appendChild(el('li', null,
          el('span', { text: e.action }), e.detail ? el('span', { class: 'detail', text: ' - ' + e.detail }) : null,
          el('span', { class: 'meta', text: '@' + e.username + ' - ' + Core.dateTime(e.created_at) })));
      });
    }

    function load() {
      PR.loading($('#details'), 'Loading');
      return Api.rpc('projects_get', { p_id: id }).then(function (r) { data = r; show(); }).catch(function (err) {
        if (err && err.code === 'NOT_FOUND') Core.showState('Project not found', 'There is no project with this id.', { href: '/projects/', label: 'All projects' });
        else PR.errorBox($('#details'), err);
      });
    }
    load();

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
