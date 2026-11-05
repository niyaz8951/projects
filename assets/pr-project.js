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

      $('#share').hidden = !data.can_share;
      var members = $('#members'); Core.clear(members);
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
