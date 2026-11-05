/* Projects tile - the Matching rules page (rules.html), for the reviewers (right 'review'; tile admins and the super
   user hold it; the database decides). Every list and number the record uses to put a datasheet value or a Product
   Options value under a clause, with its built-in value, who changed it and when; edited here and saved together
   (projects_settings_save, SQL 010); "Fixed in code" lists what the code still decides on its own; "Try a clause" shows,
   with the values on the page (saved or not), which rows a clause finds, why a row is stopped, and which figures it asks.
   No AI, no maps. Markup with Core.el and textContent only. */
(function () {
  'use strict';
  var $ = Core.$, el = Core.el, S = window.PRSettings;

  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function commas(list) { return (list || []).join(', '); }
  function splitList(text) { return String(text || '').split(/[,;\n]+/).map(function (s) { return s.trim().replace(/\s+/g, ' '); }).filter(Boolean); }

  var TITLES = {
    topics: 'Topics: the parts of a unit',
    general_topics: 'General topics',
    section_topics: 'Datasheet sections that name no part',
    parts: 'Parts of the specification searched',
    near_words: 'Keyword words apart, at most',
    max_clauses: 'Clauses per datasheet row, at most',
    keep_share: 'Weaker clauses dropped below',
    heading_words: 'A heading has at most',
    heading_verbs: 'Words that make a line a requirement, not a heading',
    label_chars: 'A label before a colon, within',
    properties: 'Properties: which way is better',
    figure_words: 'A figure belongs to a row within',
    option_values: 'Approved values used per row',
    candidates_shown: 'Values on the Selection list per row',
    choose_listed: 'Values named in a "choose:" chip'
  };
  var HELP = {
    topics: 'The topic gate. A clause about one part of the unit (its label or the heading above it names filters, fans, a VFD ...) only takes datasheet rows of that part. A clause or a row with no topic is not gated. Order matters: a text takes the first topic it names, so put the specific ones (VFD, heat pipe) above the wide ones (fan, coil). Words are whole words; "*" at the end of a word means any ending (humidif* finds humidifier and humidification); write a plural as its own word.',
    general_topics: 'A heading that names only one of these does not decide the topic of the clauses under it; the clause\'s own label does ("Casing" above "Filter frame: ..." leaves the clause a filter clause).',
    section_topics: 'A datasheet row takes the topics of its section (Filter Supply = filter). These sections name no part of the unit, so their rows get the topics listed here. The section name is compared in small letters with punctuation as spaces.',
    parts: 'Part numbers, in order. The next Part is searched only for a datasheet row the earlier one has nothing for. A Part not listed is never searched (Part 3 Execution is left out on purpose). A specification without the first Part is searched whole.',
    near_words: 'The words of one keyword entry must stand this close in the clause, so two subjects of one long clause do not make a match. Numbers between them do not count.',
    max_clauses: 'The best clauses for a row, in reading order; the rest are counted as "+ n more".',
    keep_share: 'Percent of the best clause\'s score: a clause that matches far less well than the best one for the row is noise, not a second answer.',
    heading_words: 'Words in brackets are not counted. A heading is context for the items under it (its words count 1 point instead of 2) and is not matched itself.',
    heading_verbs: 'A short line with one of these words is a requirement, not a heading.',
    label_chars: '"Fan motor: TEFC, IE3 ..." - the text before a colon this near the start is the clause\'s label; the label decides the clause\'s topic first.',
    properties: 'For a figure or a class in a clause, the property says which way is better: a thicker panel is better (higher), a lower pressure drop is better (lower), a voltage must match (exact). The longest matching term wins. A class scale is written worst first (G4, M5, F7 ...). The kind of figure keeps a property to figures of that kind (a "panel" in mm, not in Pa).',
    figure_words: 'A figure in the clause is compared with a row only when one of the row\'s keywords stands within this many words of it (or in the heading above).',
    option_values: 'The most seen approved values of a row at the record\'s factory.',
    candidates_shown: 'On the Selection list sheet of the working Excel.',
    choose_listed: 'In "choose: ..." and "none of the values seen meets ...", the rest as "and n more".'
  };
  var UNITS = { near_words: 'words', max_clauses: 'clauses', keep_share: '% of the best', heading_words: 'words', label_chars: 'characters', figure_words: 'words',
                option_values: 'values', candidates_shown: 'values', choose_listed: 'values' };
  var TABS = {
    find: ['topics', 'general_topics', 'section_topics', 'parts', 'near_words', 'max_clauses', 'keep_share', 'heading_words', 'heading_verbs', 'label_chars'],
    picks: ['properties', 'figure_words', 'option_values', 'candidates_shown', 'choose_listed']
  };
  var DIRECTIONS = [['higher', 'Higher is better'], ['lower', 'Lower is better'], ['exact', 'Must match']];
  var KINDS = { '': 'Any figure', length: 'Length (mm, m, in)', mass: 'Mass (kg, lb)', areal_mass: 'Mass per area (kg/m2)', density: 'Density (kg/m3)',
                u_value: 'U value (W/m2K)', pressure: 'Pressure (Pa, kPa, in.wg)', flow: 'Air flow (m3/h, l/s, cfm)', power: 'Power (kW, TR, Btu/h)',
                velocity: 'Velocity (m/s, fpm)', time: 'Time (h, years)', temperature: 'Temperature (C, F)' };

  /* What the code decides on its own: shown so nothing is hidden; changed only in the code. */
  var FIXED = [
    ['Finding the row (cm-rows.js)', [
      'The Spec keywords of each datasheet row are on the Row mapping page (Product Options > Row mapping), one list per product. They are data: change them there.',
      'An entry (between ";") finds a clause when every word of the entry starts a word of the clause or of the heading above it: "fin spac" finds "fins shall be spaced".',
      'Score per entry: 2 points per word found in the clause, 1 per word found only in the heading above, 1 more when the words stand side by side. The scores of a row\'s entries add up.',
      'Section titles ("2.02 CASING") are never matched: they would match every clause of the section. A short title with items under it ("G. Air Filters") is context for its items only.',
      'Lines of a table of contents (five dots or more) are skipped.',
      'The topic of a clause: a heading above it that names a specific part, nearest first; else the clause\'s own label or first six words; else a general heading; else the section title.',
      'A product without a row mapping shows no datasheet rows under its clauses.'
    ]],
    ['What the record shows (owner decisions, 2026-11-05)', [
      'Blue chips: the project\'s datasheet value of each row the clause asks about. A unit read again is taken from the newest table only; a row printed twice (Filter 1, Filter 2) shows both, told apart by their sub-heading.',
      'Dashed chips: only for a row the project has no datasheet value for (no datasheet, or the row is not on it). Approved Product Options values only; a value waiting for approval never shows.',
      'Green: the compliance library\'s approved answer of the identical clause at the same factory, pre-filled. Identical = the same text in small letters with every run of other characters as one space; at least 8 characters. Only an answer approved in Compliance review is the library\'s.',
      'All three show at once, under every clause, with no extra step; the legend line on the record names the three colours.'
    ]],
    ['Product Options picks (pr-picks.js)', [
      'The value that exactly meets the clause first; else the closest value on the better side (closest higher for "minimum", closest lower for "maximum"); never a value on the worse side. Ties: the most seen value.',
      'When every approved value fails the clause: "none of the values seen meets ... : ask the factory". One value only: "the only value seen". No figure to compare: "choose:" with the values seen.',
      'Words read as "at least": minimum, min., at least, not less than, no less than, or more, or greater, or higher, or better, greater than, more than, above, over, exceeding. As "at most": maximum, max., at most, up to, limited to, not exceed, not more than, or less, or lower, less than, below, under. "X to Y" and "between X and Y" are ranges.',
      'A figure in a condition is not a requirement: after "at", "@", "exposed to", "tested at", "test pressure of", or in an "if / when / unless" part without "shall" or "must".',
      'Units read and converted: mm, cm, m, in, ft; kg, lb, t; kg/m2; kg/m3; W/m2K; Pa, kPa, bar, psi, in.wg; m3/h, l/s, cfm; W, kW, TR, Btu/h, kcal/h; m/s, fpm; h, years; C, F. Also %, dB(A), rpm, Hz, V, A, micron, IP ratings (compared only with the same unit).',
      'A length figure is compared only with a row of the same dimension: thickness, diameter, spacing, height, width, length, depth (a "size" row takes height, width, length or depth).',
      'A % figure is compared only when both name the same measure: arrestance, coarse, ePM1, ePM2.5, ePM10, MERV, dust spot, efficiency, humidity, recirculation, leakage, slope, speed, torque.',
      'Duty figures (flows, pressures, capacities, sizes ...), project conditions (location, altitude, air density) and hidden rows are never options. Which is which is worked out from the row name; a reviewer changes it per row on Row mapping ("In Product Options") or on Product Options (Move to duty figures / Move to options).'
    ]]
  ];

  var state = { saved: {}, meta: {}, current: null, draft: null, ok: false, rules: {}, products: [] };

  function changedKeys() { return S.ORDER.filter(function (k) { return !same(state.draft[k], state.current[k]); }); }
  function isBuiltIn(k, v) { return same(v, S.DEFAULTS[k]); }

  /* ---------- save bar ---------- */
  function refreshBar() {
    var n = changedKeys().length, bar = $('#mr-savebar');
    bar.hidden = !n;
    $('#mr-count').textContent = n + (n === 1 ? ' setting changed, not saved yet' : ' settings changed, not saved yet');
    $('#mr-save').disabled = !state.ok;
  }
  window.addEventListener('beforeunload', function (e) { if (state.draft && changedKeys().length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- one card per setting ---------- */
  var cards = {};
  function card(key, body) {
    var err = el('p', { class: 'mr-error', role: 'alert', hidden: true });
    var status = el('span', { class: 'mr-status' });
    var back = el('button', { type: 'button', class: 'btn ghost small', text: 'Back to built-in',
      on: { click: function () { setDraft(key, copy(S.DEFAULTS[key])); render(key); } } });
    var c = el('section', { class: 'card mr-card', id: 'set-' + key, 'aria-labelledby': 'h-' + key },
      el('div', { class: 'mr-card-head' },
        el('h2', { id: 'h-' + key, text: TITLES[key] }), status),
      el('p', { class: 'muted mr-help', text: HELP[key] }),
      el('div', { class: 'mr-body' }, body),
      err,
      el('div', { class: 'row mr-foot' }, back));
    cards[key] = { node: c, err: err, status: status, back: back };
    return c;
  }
  function paintStatus(key) {
    var c = cards[key]; if (!c) return;
    var d = state.draft[key], msg = S.check(key, d);
    c.err.hidden = !msg; c.err.textContent = msg ? 'Not saved like this: ' + msg + '.' : '';
    c.node.classList.toggle('mr-bad', !!msg);
    Core.clear(c.status);
    if (!same(d, state.current[key])) c.status.appendChild(el('span', { class: 'badge warning', text: 'Changed, not saved' }));
    else if (state.meta[key]) c.status.appendChild(el('span', { class: 'badge accent', text: 'Changed by ' + (state.meta[key].by || 'a reviewer') + ', ' + Core.date(state.meta[key].at) }));
    else c.status.appendChild(el('span', { class: 'badge', text: 'Built-in' }));
    c.back.hidden = isBuiltIn(key, d);
  }
  function setDraft(key, v) { state.draft[key] = v; paintStatus(key); refreshBar(); }

  /* ---------- editors ---------- */
  function numberEditor(key) {
    var r = S.NUMBERS[key];
    var input = el('input', { type: 'number', inputmode: 'numeric', min: r[0], max: r[1], step: 1, value: state.draft[key], id: 'in-' + key, class: 'mr-num' });
    input.addEventListener('input', function () { var n = input.value === '' ? NaN : Number(input.value); setDraft(key, isNaN(n) ? input.value : n); });
    return el('div', { class: 'mr-numrow' },
      el('label', { for: 'in-' + key, class: 'sr-only', text: TITLES[key] }), input,
      el('span', { class: 'muted', text: UNITS[key] + ' (built-in ' + S.DEFAULTS[key] + '; ' + r[0] + ' to ' + r[1] + ')' }));
  }
  function listEditor(key, lower) {
    var ta = el('textarea', { rows: 2, id: 'in-' + key, class: 'mr-text', spellcheck: 'false' });
    ta.value = commas(state.draft[key]);
    ta.addEventListener('input', function () {
      var list = splitList(ta.value);
      if (key === 'parts') list = list.map(function (x) { return /^\d+$/.test(x) ? Number(x) : x; });
      else if (lower) list = list.map(function (x) { return x.toLowerCase(); });
      setDraft(key, list);
    });
    return el('div', {}, el('label', { for: 'in-' + key, class: 'sr-only', text: TITLES[key] }), ta,
      el('p', { class: 'faint small', text: 'Separate with commas. Built-in: ' + commas(S.DEFAULTS[key]) }));
  }
  function moveBtn(label, title, fn) { return el('button', { type: 'button', class: 'btn ghost small', title: title, 'aria-label': title, text: label, on: { click: fn } }); }

  function topicsEditor() {
    var host = el('div', { class: 'mr-list' });
    function draw() {
      Core.clear(host);
      state.draft.topics.forEach(function (t, i) {
        var name = el('input', { type: 'text', value: t.id, maxlength: 30, 'aria-label': 'Topic name', class: 'mr-id', spellcheck: 'false' });
        var words = el('textarea', { rows: 2, 'aria-label': 'Words of the topic ' + t.id, class: 'mr-text', spellcheck: 'false' });
        words.value = commas(t.words);
        name.addEventListener('input', function () { var d = copy(state.draft.topics); d[i].id = name.value.trim().toLowerCase(); setDraft('topics', d); });
        words.addEventListener('input', function () { var d = copy(state.draft.topics); d[i].words = splitList(words.value).map(function (x) { return x.toLowerCase(); }); setDraft('topics', d); });
        function move(by) { var d = copy(state.draft.topics), x = d.splice(i, 1)[0]; d.splice(i + by, 0, x); setDraft('topics', d); draw(); }
        host.appendChild(el('div', { class: 'mr-item' },
          el('div', { class: 'mr-item-head' },
            el('span', { class: 'mr-n', text: String(i + 1) }), name,
            el('div', { class: 'row' },
              i > 0 ? moveBtn('↑', 'Move up', function () { move(-1); }) : null,
              i < state.draft.topics.length - 1 ? moveBtn('↓', 'Move down', function () { move(1); }) : null,
              moveBtn('Remove', 'Remove this topic', function () { var d = copy(state.draft.topics); d.splice(i, 1); setDraft('topics', d); draw(); }))),
          words));
      });
      host.appendChild(el('button', { type: 'button', class: 'btn small', text: 'Add a topic', on: { click: function () {
        var d = copy(state.draft.topics); d.push({ id: 'new_topic', words: ['word'] }); setDraft('topics', d); draw();
        var last = host.querySelectorAll('.mr-id'); if (last.length) { last[last.length - 1].focus(); last[last.length - 1].select(); }
      } } }));
    }
    draw();
    cards.__drawTopics = draw;
    return host;
  }

  function sectionsEditor() {
    var host = el('div', { class: 'mr-list' });
    function draw() {
      Core.clear(host);
      state.draft.section_topics.forEach(function (s, i) {
        var sec = el('input', { type: 'text', value: s.section, maxlength: 80, 'aria-label': 'Datasheet section', spellcheck: 'false' });
        var how = el('select', { 'aria-label': 'How the section name is compared' },
          el('option', { value: 'is', text: 'is', selected: s.how === 'is' }), el('option', { value: 'starts', text: 'starts with', selected: s.how === 'starts' }));
        var tops = el('input', { type: 'text', value: commas(s.topics), 'aria-label': 'Topics of its rows', spellcheck: 'false' });
        function upd() {
          var d = copy(state.draft.section_topics);
          d[i] = { section: sec.value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), how: how.value, topics: splitList(tops.value).map(function (x) { return x.toLowerCase(); }) };
          setDraft('section_topics', d);
        }
        [sec, tops].forEach(function (x) { x.addEventListener('input', upd); }); how.addEventListener('change', upd);
        host.appendChild(el('div', { class: 'mr-item mr-sec' },
          el('label', { class: 'field' }, el('span', { text: 'Section' }), el('div', { class: 'mr-sec-name' }, how, sec)),
          el('label', { class: 'field' }, el('span', { text: 'Its rows are about' }), tops),
          moveBtn('Remove', 'Remove this line', function () { var d = copy(state.draft.section_topics); d.splice(i, 1); setDraft('section_topics', d); draw(); })));
      });
      host.appendChild(el('button', { type: 'button', class: 'btn small', text: 'Add a section', on: { click: function () {
        var d = copy(state.draft.section_topics); d.push({ section: 'section name', how: 'is', topics: ['casing'] }); setDraft('section_topics', d); draw();
      } } }));
    }
    draw();
    cards.__drawSections = draw;
    return host;
  }

  function propertiesEditor() {
    var host = el('div', { class: 'mr-list' });
    function draw() {
      Core.clear(host);
      state.draft.properties.forEach(function (p, i) {
        var name = el('input', { type: 'text', value: p.name, maxlength: 80 });
        var terms = el('textarea', { rows: 2, class: 'mr-text', spellcheck: 'false' }); terms.value = commas(p.terms);
        var dir = el('select', {}, DIRECTIONS.map(function (d) { return el('option', { value: d[0], text: d[1], selected: p.direction === d[0] }); }));
        var kind = el('select', {}, Object.keys(KINDS).map(function (k) { return el('option', { value: k, text: KINDS[k], selected: p.unit === k }); }));
        var scale = el('input', { type: 'text', value: commas(p.scale), spellcheck: 'false', placeholder: 'none' });
        function upd() {
          var d = copy(state.draft.properties);
          d[i] = { name: name.value.trim(), terms: splitList(terms.value).map(function (x) { return x.toLowerCase(); }), direction: dir.value, unit: kind.value,
                   scale: splitList(scale.value).map(function (x) { return x.toUpperCase().replace(/\s+/g, ''); }) };
          setDraft('properties', d);
        }
        [name, terms, scale].forEach(function (x) { x.addEventListener('input', upd); }); [dir, kind].forEach(function (x) { x.addEventListener('change', upd); });
        host.appendChild(el('details', { class: 'mr-item mr-prop' },
          el('summary', {}, el('strong', { text: p.name || '(no name)' }), el('span', { class: 'muted', text: ' - ' + DIRECTIONS.filter(function (d) { return d[0] === p.direction; }).map(function (d) { return d[1].toLowerCase(); })[0] + (p.scale.length ? ', classes ' + p.scale[0] + ' … ' + p.scale[p.scale.length - 1] : '') })),
          el('div', { class: 'mr-prop-grid' },
            el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
            el('label', { class: 'field' }, el('span', { text: 'Which way is better' }), dir),
            el('label', { class: 'field' }, el('span', { text: 'Kind of figure' }), kind),
            el('label', { class: 'field mr-wide' }, el('span', { text: 'Words that name it (commas)' }), terms),
            el('label', { class: 'field mr-wide' }, el('span', { text: 'Class scale, worst first (commas; empty for figures)' }), scale)),
          el('div', { class: 'row' }, moveBtn('Remove', 'Remove this property', function () { var d = copy(state.draft.properties); d.splice(i, 1); setDraft('properties', d); draw(); }))));
      });
      host.appendChild(el('button', { type: 'button', class: 'btn small', text: 'Add a property', on: { click: function () {
        var d = copy(state.draft.properties); d.push({ name: 'new property', terms: ['word'], direction: 'higher', unit: '', scale: [] }); setDraft('properties', d); draw();
        var all = host.querySelectorAll('details'); if (all.length) all[all.length - 1].open = true;
      } } }));
    }
    draw();
    cards.__drawProps = draw;
    return host;
  }

  function editorFor(key) {
    if (S.NUMBERS[key]) return numberEditor(key);
    if (key === 'topics') return topicsEditor();
    if (key === 'section_topics') return sectionsEditor();
    if (key === 'properties') return propertiesEditor();
    if (key === 'general_topics' || key === 'heading_verbs') return listEditor(key, true);
    if (key === 'parts') return listEditor(key, false);
    return el('p', { text: '' });
  }

  /* ---------- panels ---------- */
  var panels = {};
  function buildPanels() {
    var host = $('#mr-panels'); Core.clear(host);
    panels.find = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'find' },
      el('p', { class: 'muted', text: 'A clause is matched to the datasheet rows whose Spec keywords it holds (Row mapping). These settings decide how the keywords are weighed, which clauses are searched and which rows a clause may take.' }),
      el('p', {}, el('a', { href: '/projects/mapping.html', text: 'Open Row mapping (the keywords of each row)' })),
      TABS.find.map(function (k) { return card(k, editorFor(k)); }));
    panels.picks = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'picks', hidden: true },
      el('p', { class: 'muted', text: 'For a row the project has no datasheet value for, the dashed chip names the approved Product Options value that meets the clause. These settings decide what "meets" and "better" mean.' }),
      TABS.picks.map(function (k) { return card(k, editorFor(k)); }));
    panels.record = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'record', hidden: true }, fixedCard(FIXED[1]));
    panels.fixed = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'fixed', hidden: true },
      el('p', { class: 'muted', text: 'What the code still decides on its own. Nothing is hidden: if one of these needs to change, ask for it to be moved to the settings above.' }),
      fixedCard(FIXED[0]), fixedCard(FIXED[2]));
    panels['try'] = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'try', hidden: true }, tryCard());
    panels.history = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'history', hidden: true }, historyCard());
    Object.keys(panels).forEach(function (k) { host.appendChild(panels[k]); });
    S.ORDER.forEach(paintStatus);
  }
  function fixedCard(group) {
    return el('section', { class: 'card' }, el('h2', { text: group[0] }),
      el('ul', { class: 'mr-fixed' }, group[1].map(function (t) { return el('li', { text: t }); })));
  }

  function render(key) {
    if (key === 'topics' && cards.__drawTopics) cards.__drawTopics();
    else if (key === 'section_topics' && cards.__drawSections) cards.__drawSections();
    else if (key === 'properties' && cards.__drawProps) cards.__drawProps();
    else {
      var input = document.getElementById('in-' + key);
      if (input) input.value = S.NUMBERS[key] ? state.draft[key] : commas(state.draft[key]);
    }
    paintStatus(key); refreshBar();
  }

  function showTab(name) {
    [].forEach.call(document.querySelectorAll('#mr-tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== name; });
    if (name === 'history') loadHistory();
  }
  $('#mr-tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) showTab(b.getAttribute('data-tab')); });

  /* ---------- try a clause ---------- */
  var tryOut;
  function tryCard() {
    var prod = el('select', { id: 'try-product' }, state.products.map(function (p) { return el('option', { value: p.id, text: p.name }); }));
    var head = el('input', { type: 'text', id: 'try-head', maxlength: 200, placeholder: 'e.g. Air Filters (optional)' });
    var text = el('textarea', { id: 'try-text', rows: 4, maxlength: 3000, placeholder: 'e.g. Pre-filters shall be 50 mm thick pleated panels, class G4 minimum.' });
    tryOut = el('div', { class: 'mr-try-out', 'aria-live': 'polite' });
    var go = el('button', { type: 'button', id: 'try-go', class: 'btn primary', text: 'Try', on: { click: function () { runTry(); } } });
    text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runTry(); });
    return el('section', { class: 'card stack' },
      el('h2', { text: 'Try a clause' }),
      el('p', { class: 'muted', text: 'Type or paste one clause. It is matched with the values on this page, saved or not, so you can see what a change does before you save it. Nothing is saved or sent.' }),
      el('div', { class: 'mr-try-grid' },
        el('label', { class: 'field' }, el('span', { text: 'Product (its row mapping)' }), prod),
        el('label', { class: 'field' }, el('span', { text: 'Heading above the clause' }), head)),
      el('label', { class: 'field' }, el('span', { text: 'Clause' }), text),
      el('div', { class: 'row' }, go),
      tryOut);
  }
  function rulesOf(productId) {
    if (!state.rules[productId]) state.rules[productId] = Api.dnRules(null, productId).then(function (r) { return (r && r.rules) || []; });
    return state.rules[productId];
  }
  function runTry() {
    var text = $('#try-text').value.trim(), head = $('#try-head').value.trim(), productId = $('#try-product').value;
    Core.clear(tryOut);
    if (!text) { tryOut.appendChild(el('p', { class: 'muted', text: 'Type a clause first.' })); return; }
    var bad = S.ORDER.filter(function (k) { return S.check(k, state.draft[k]); });
    if (bad.length) { tryOut.appendChild(el('p', { class: 'mr-error', text: 'Fix the setting "' + TITLES[bad[0]] + '" first.' })); return; }
    tryOut.appendChild(el('p', { class: 'muted', text: 'Matching…' }));
    rulesOf(productId).then(function (rules) {
      S.apply(state.draft);
      var part = state.draft.parts[0];
      var rows = [{ type: 'part', sr: '', spec: 'PART ' + part + ' - PRODUCTS' }, { type: 'section', sr: part + '.01', spec: 'SECTION' }];
      if (head) { rows.push({ type: 'letter', sr: 'A.', spec: head }); rows.push({ type: 'number', sr: '1.', spec: text }); }
      else rows.push({ type: 'letter', sr: 'A.', spec: text });
      var cl = window.CMRows.clauses(rows), c = cl[cl.length - 1];
      Core.clear(tryOut);
      if (!c || c.row !== rows.length - 1) { tryOut.appendChild(el('p', { class: 'notice', text: 'This reads as a heading, not a clause (short, without ' + commas(state.draft.heading_verbs) + '): a heading is only context for the items under it.' })); return; }
      tryOut.appendChild(el('p', {}, el('strong', { text: 'Topic of the clause: ' }), c.topic || 'none (not gated: any row may take it)'));
      var hits = [], stopped = [];
      rules.forEach(function (r) {
        if (r.show === false) return;
        var entries = String(r.keywords || '').split(';').map(function (e) { return e.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }).filter(Boolean).map(function (e) { return e.split(' '); });
        if (!entries.length) return;
        var s = window.CMRows.score(entries, c);
        if (!s) return;
        var topics = window.CMRows.rowTopics(r), name = (String(r.label || '').trim() || r.component) + ' (' + r.section + (r.sub ? ' / ' + r.sub : '') + ')';
        var gated = topics.length && c.topic && topics.indexOf(c.topic) < 0;
        (gated ? stopped : hits).push({ name: name, s: s, topics: topics, kw: r.keywords });
      });
      hits.sort(function (a, b) { return b.s - a.s; }); stopped.sort(function (a, b) { return b.s - a.s; });
      var top = hits.length ? hits[0].s : 0;
      tryOut.appendChild(el('h3', { text: hits.length ? 'Datasheet rows it finds' : 'No datasheet row finds it' }));
      if (hits.length) tryOut.appendChild(el('ul', { class: 'mr-hits' }, hits.slice(0, 20).map(function (h) {
        var weak = h.s * 100 < top * state.draft.keep_share;
        return el('li', { class: weak ? 'mr-weak' : '' }, el('strong', { text: h.name }), ' - score ' + h.s + (weak ? ' (would be dropped: below ' + state.draft.keep_share + '% of the best, if the rows sit in one clause)' : ''),
          el('span', { class: 'faint small mr-kw', text: 'keywords: ' + h.kw + (h.topics.length ? ' · row topics: ' + commas(h.topics) : '') }));
      })));
      if (stopped.length) {
        tryOut.appendChild(el('h3', { text: 'Stopped by the topic gate' }));
        tryOut.appendChild(el('ul', { class: 'mr-hits' }, stopped.slice(0, 20).map(function (h) {
          return el('li', {}, el('strong', { text: h.name }), ' - its keywords match (score ' + h.s + '), but the row is about ' + commas(h.topics) + ', the clause about ' + c.topic + '.');
        })));
      }
      // the figures and classes the clause asks for, as the Product Options picks read them
      var reqs = window.PRPicks.requirements(text), classes = window.PRPicks.classRequirements(text);
      tryOut.appendChild(el('h3', { text: 'Figures and classes it asks for' }));
      if (!reqs.length && !classes.length) tryOut.appendChild(el('p', { class: 'muted', text: 'None found: the dashed chip would say "choose:" with the values seen.' }));
      var OP = { '>=': 'at least', '<=': 'at most', '=': 'equal to', range: 'within' };
      tryOut.appendChild(el('ul', { class: 'mr-hits' },
        reqs.map(function (r) {
          var p = window.PRPicks.propertyOf(text.slice(Math.max(0, r.at - 80), r.at + 40), { family: null, classed: false });
          return el('li', {}, el('strong', { text: r.op === 'range' ? r.lo + ' to ' + r.m.raw : r.m.raw }),
            r.condition ? ' - a condition, not a requirement' : ' - ' + OP[r.op] + (p ? ' · ' + p.name + ', ' + DIRECTIONS.filter(function (d) { return d[0] === p.direction; })[0][1].toLowerCase() : ' · no property names it: only an exact match counts'));
        }),
        classes.map(function (cl2) { return el('li', {}, el('strong', { text: cl2.cls }), ' - ' + cl2.prop.name + ', this class or better (scale ' + commas(cl2.prop.scale) + ')'); })));
      S.apply(state.current);
    }, function (err) { Core.clear(tryOut); tryOut.appendChild(el('p', { class: 'mr-error', text: Core.errorMessage(err) })); });
  }

  /* ---------- history ---------- */
  var histHost;
  function historyCard() {
    histHost = el('div', { class: 'stack' }, el('p', { class: 'muted', text: 'Loading…' }));
    return el('section', { class: 'card stack' }, el('h2', { text: 'History' }),
      el('p', { class: 'muted', text: 'Every saved change, newest first. "Put this back" puts the earlier value on the page; it is saved with Save changes.' }), histHost);
  }
  function summary(key, v) {
    if (v === null || v === undefined) return 'built-in (' + summary(key, S.DEFAULTS[key]) + ')';
    if (typeof v === 'number') return String(v);
    if (key === 'topics') return v.length + ' topics';
    if (key === 'properties') return v.length + ' properties';
    if (key === 'section_topics') return v.length + ' sections';
    return commas(v);
  }
  // lists of named items: which were added, taken out or changed, by name
  var NAMED = { topics: 'id', properties: 'name', section_topics: 'section' };
  function change(key, o, n) {
    var by = NAMED[key];
    if (!by) return summary(key, o) + ' → ' + summary(key, n);
    var a = o == null ? S.DEFAULTS[key] : o, b = n == null ? S.DEFAULTS[key] : n, out = [];
    var names = function (list) { return list.map(function (x) { return x[by]; }); };
    var add = b.filter(function (x) { return names(a).indexOf(x[by]) < 0; }).map(function (x) { return x[by]; });
    var gone = a.filter(function (x) { return names(b).indexOf(x[by]) < 0; }).map(function (x) { return x[by]; });
    var edit = b.filter(function (x) { var y = a.filter(function (z) { return z[by] === x[by]; })[0]; return y && !same(x, y); }).map(function (x) { return x[by]; });
    if (add.length) out.push('added ' + commas(add));
    if (gone.length) out.push('took out ' + commas(gone));
    if (edit.length) out.push('changed ' + commas(edit));
    if (!out.length && !same(a, b)) out.push('new order');
    return (out.join('; ') || 'no difference') + (n == null ? ' (back to built-in)' : o == null ? ' (from built-in)' : '');
  }
  function loadHistory() {
    if (!state.ok) { Core.clear(histHost); histHost.appendChild(el('p', { class: 'muted', text: 'No history until SQL 010 is run.' })); return; }
    Api.rpc('projects_settings_history', { p_limit: 200 }).then(function (list) {
      Core.clear(histHost);
      if (!list || !list.length) { histHost.appendChild(el('p', { class: 'muted', text: 'No change yet: every setting is the built-in value.' })); return; }
      histHost.appendChild(el('ul', { class: 'pr-log' }, list.map(function (h) {
        var back = el('button', { type: 'button', class: 'btn ghost small', text: 'Put this back', on: { click: function () {
          if (!S.ORDER.includes(h.key)) return;
          setDraft(h.key, h.old == null ? copy(S.DEFAULTS[h.key]) : copy(h.old)); render(h.key);
          Core.toast('The earlier value is on the page. Save changes to keep it.');
        } } });
        return el('li', {},
          el('strong', { text: TITLES[h.key] || h.key }), ': ' + change(h.key, h.old, h.new),
          el('span', { class: 'meta', text: (h.by || 'a reviewer') + ', ' + Core.dateTime(h.at) }),
          el('div', { class: 'row' }, back));
      })));
    }, function (err) { Core.clear(histHost); histHost.appendChild(el('p', { class: 'mr-error', text: Core.errorMessage(err) })); });
  }

  /* ---------- save ---------- */
  $('#mr-discard').addEventListener('click', function () {
    var keys = changedKeys();
    keys.forEach(function (k) { state.draft[k] = copy(state.current[k]); render(k); });
  });
  $('#mr-save').addEventListener('click', function () {
    var keys = changedKeys();
    var bad = keys.filter(function (k) { return S.check(k, state.draft[k]); });
    if (bad.length) { showTab(TABS.find.indexOf(bad[0]) >= 0 ? 'find' : 'picks'); document.getElementById('set-' + bad[0]).scrollIntoView({ block: 'start' }); Core.toast('Fix "' + TITLES[bad[0]] + '" first.', 'danger'); return; }
    // a topic named in General topics or in a section line must exist, or those rows would never match
    var ids = state.draft.topics.map(function (t) { return t.id; });
    var named = state.draft.general_topics.slice();
    state.draft.section_topics.forEach(function (s) { named = named.concat(s.topics); });
    var unknown = named.filter(function (x) { return ids.indexOf(x) < 0; });
    var ask = unknown.length ? Core.confirm('These topics are named but not in the topic list, so they change nothing: ' + commas(unknown.filter(function (x, i, a) { return a.indexOf(x) === i; })) + '. Save anyway?', { title: 'Unknown topics', ok: 'Save' }) : Promise.resolve(true);
    ask.then(function (yes) {
      if (!yes) return;
      var values = {};
      keys.forEach(function (k) { values[k] = isBuiltIn(k, state.draft[k]) ? null : state.draft[k]; });
      return Core.busy($('#mr-save'), function () {
        return Api.rpc('projects_settings_save', { p_values: values }).then(function (r) {
          return S.reload().then(function (got) {
            state.current = copy(got.values); state.meta = got.saved;
            S.ORDER.forEach(function (k) { if (keys.indexOf(k) < 0) return; paintStatus(k); });
            refreshBar();
            var n = (r && r.changed || []).length;
            Core.toast(n ? n + (n === 1 ? ' setting saved. Records opened from now on use it.' : ' settings saved. Records opened from now on use them.') : 'Nothing to save.', 'success');
          });
        });
      }).catch(function (err) { Core.showError(err); });
    });
  });

  /* ---------- start ---------- */
  Core.requireLogin({ tile: PR.TILE, right: 'review' }).then(function () {
    return Promise.all([S.load(), Api.rpc('projects_products').then(null, function () { return []; })]);
  }).then(function (got) {
    var s = got[0];
    state.ok = s.ok; state.meta = s.saved; state.current = copy(s.values); state.draft = copy(s.values);
    state.products = (got[1] || []).filter(function (p) { return p.active !== false; });
    if (!state.products.length) state.products = [{ id: 'ahu', name: 'AHU' }, { id: 'fcu', name: 'FCU' }];
    if (!s.ok) { var off = $('#mr-off'); off.hidden = false; off.textContent = 'The saved settings could not be read, so the built-in values are shown and saving is off. If SQL 010 (db/projects/010_matching_rules.sql) has not been run yet, run it; otherwise reload the page.'; }
    buildPanels();
    refreshBar();
    var want = (window.location.hash || '').replace('#', '');
    if (panels[want]) showTab(want);
  }).catch(function (err) { Core.showError(err); });
})();
