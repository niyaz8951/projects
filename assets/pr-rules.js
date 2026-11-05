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
    choose_listed: 'Values named in a "choose:" chip',
    vocab_products: 'Match this product by its vocabulary',
    vocab_fallback: 'Keywords where the vocabulary finds nothing',
    vocab_types: 'Requirement types per clause, at most',
    answer_choices: 'The answers of the Compliance column',
    hint_scope: 'Hint "In Contractor\'s Scope?"',
    hint_absent: 'Hint "Not Applicable?"',
    scope_parts: 'Parts that are the contractor\'s work',
    scope_words: 'Words that put a clause in the contractor\'s scope',
    scope_sections: 'Section titles that are the contractor\'s work',
    scope_manufacturer: 'Words of the manufacturer\'s own work',
    absent_rules: 'Not in this unit: the rules'
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
    choose_listed: 'In "choose: ..." and "none of the values seen meets ...", the rest as "and n more".',
    vocab_products: 'Off: every datasheet row is found by its Spec keywords, as before. On: a row that a verified type of the vocabulary points at (Row:) is found by the vocabulary - what the clause asks, by its landmarks; a "#2" row (Filter 2) gets only the clauses about it. Rows no verified type points at keep their Spec keywords. Only verified items are read.',
    vocab_fallback: 'For a row the vocabulary covers but finds no clause for in this specification: on, its Spec keywords are used instead (you never see fewer rows than with keywords); off, the row stays empty (no keyword guesses for rows the vocabulary covers).',
    answer_choices: 'Users pick the Compliance of a clause from this list, in this order; nothing else can be typed or saved (the database refuses it). One answer per line. Add one when the team needs it; renaming or removing one leaves the answers already saved as they are - they show "(not in the list)" until someone picks again. The hints use "Not Applicable" and "In Contractor\'s Scope": keep them in the list for the hints to work. An uploaded Excel file still puts its words into these standard ones ("By contractor" becomes "In Contractor\'s Scope").',
    hint_scope: 'Under a clause that is the contractor\'s work, a dotted hint "In Contractor\'s Scope?" with the reason. The compliance is answered as the manufacturer (AHU, FCU or chiller maker) for the contractor and the consultant. In Edit a press on the hint answers the clause; nothing is ever filled by itself.',
    hint_absent: 'Under a clause that asks for something the unit has not (no humidifier, no heater, belts with EC direct-drive fans ...), a dotted hint "Not Applicable?" with the reason. Only when the project holds a datasheet of the product: the datasheet is the proof.',
    scope_parts: 'Every clause of these Parts gets the hint (Part 3, Execution: installation, connections, field tests, cleaning), unless the clause or its section names the manufacturer\'s own work (below). Leave it empty to hint by words and section titles only.',
    scope_words: 'A clause holding one of these gets the hint in any Part, even beside the manufacturer\'s words ("Fan drives shall be factory mounted with belt adjustment by the Contractor"). Whole words; "*" at the end of a word means any ending; punctuation counts as a space ("Contractor\'s" is "contractor s").',
    scope_sections: 'Every clause of a section whose title holds one of these gets the hint (1.6 Coordination, 3.2 Installation ...), unless the clause or the section names the manufacturer\'s own work.',
    scope_manufacturer: 'The manufacturer\'s own work in Part 3 and in contractor sections: field service, start-up, training, factory tests. A clause or section title with one of these gets no Part or section hint (a scope word above still counts).',
    absent_rules: 'Each rule: the words in the clause (or in the heading above it) that ask for a part of the unit, and what the project\'s datasheet must show for the hint - one of "has" (if any listed) and none of "lacks". The first rule that fits gives the reason. Products: the products the rule is for (empty = every product).',
    vocab_types: 'A long clause asks several things ("50 mm thick, galvanized, steel frame, hinged doors"). The record reads up to this many requirement types in one clause, best first, counting only types that point at a datasheet row; types scoring below 60% of the best are dropped. Try a clause lists every type it recognises.'
  };
  var UNITS = { vocab_types: 'types', near_words: 'words', max_clauses: 'clauses', keep_share: '% of the best', heading_words: 'words', label_chars: 'characters', figure_words: 'words',
                option_values: 'values', candidates_shown: 'values', choose_listed: 'values' };
  var TABS = {
    find: ['topics', 'general_topics', 'section_topics', 'parts', 'near_words', 'max_clauses', 'keep_share', 'heading_words', 'heading_verbs', 'label_chars'],
    picks: ['properties', 'figure_words', 'option_values', 'candidates_shown', 'choose_listed'],
    answers: ['answer_choices'],
    hints: ['hint_scope', 'hint_absent', 'scope_parts', 'scope_words', 'scope_sections', 'scope_manufacturer', 'absent_rules']
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
      'All three show at once, under every clause, with no extra step; the legend line on the record names the three colours.',
      'Hints (013, Hints tab): a dotted "In Contractor\'s Scope?" or "Not Applicable?" with its reason, under the clauses the rules pick, while the clause has another answer. A press in Edit answers the clause and saves it as if typed; Remarks stay yours. Nothing is filled by itself; hints are not in the Excel files. The compliance is the manufacturer\'s, for the contractor and the consultant.',
      'A mark on a blue chip (012): \u2713 meets / \u2713 better / \u2260 check / \u2717 not met - the datasheet figure or class against the clause, only where a whole keyword of the row stands near the figure.'
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
    ]],
    ['The vocabulary (pr-vocab.js, the old identify())', [
      'A term is found as a whole word or phrase, with an ending s, es, ed or ing allowed; a hyphen counts as a space; where two terms cover the same words, the longer one counts.',
      'Score of a type: its two rarest property terms (the rarer a term among all types, the more it weighs: up to 4, times 2 for the first and 0.6 for the second); +2 when the clause names the type\'s component, +1.2 when only its heading does; +3 for an anchor or a class of its scale (+0.8 for a short anchor standing alone); +1.5 for component and property together; -3 (-1.5 with the component in the heading) when the clause names other components and not this one; +1.5 for its standard; for a figure in the type\'s unit +4 when near its words, +1.5 farther away, -1 when the figures are in other units; -5 for a Not word; +1 for an option named; for a class +1.5 when the class is written, -1.5 when only figures are.',
      'Generic words (rating, capacity, diameter, length, depth, width, lock, stainless steel) count only beside the type\'s component.',
      'A component alone is not a requirement: a type needs a property term or an anchor. A type is recognised at a score of 3.5 or more; at most 3 types per clause, those scoring below 60% of the best are dropped, and two types of one component found by the same words count once.',
      'An Equivalent ("MERV 14 = F8") reads the class from another scale; a range on its left side ("MERV 7-8") is for people only. A class asked is a minimum.',
      'The heading above the clause and the section title count as its heading. The Parts searched, the clauses per row and the weaker-clause share of "Finding the row" apply to the vocabulary too; the topic gate does not (the components do that job).',
      'On the record, a clause takes up to "Requirement types per clause" types (Vocabulary tab), counting only types that point at a datasheet row; Try a clause lists up to 10, with or without a row.',
      'On the record, a value type with a unit (Panel thickness in mm, Supply air flow in m3/h) counts for a clause only when the clause states a figure in that unit, so "provided in the panel" or "airflow switch" does not bring the panel or the air flow row.'
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
      if (key === 'parts' || key === 'scope_parts') list = list.map(function (x) { return /^\d+$/.test(x) ? Number(x) : x; });
      else if (lower) list = list.map(function (x) { return x.toLowerCase().replace(/[^a-z0-9*]+/g, ' ').trim(); }).filter(Boolean);
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

  function boolEditor(key, label) {
    var box = el('input', { type: 'checkbox', id: 'in-' + key });
    box.checked = state.draft[key] !== false;
    box.addEventListener('change', function () { setDraft(key, box.checked); });
    return el('label', { class: 'check' }, box, ' ' + label);
  }
  // the "Not in this unit" rules: one fold per rule
  function absentEditor() {
    var host = el('div', { class: 'mr-list' });
    function draw() {
      Core.clear(host);
      state.draft.absent_rules.forEach(function (r, i) {
        var label = el('input', { type: 'text', value: r.label, maxlength: 120 });
        var prods = el('input', { type: 'text', value: commas(r.products), spellcheck: 'false', placeholder: 'every product' });
        var clause = el('textarea', { rows: 2, class: 'mr-text', spellcheck: 'false' }); clause.value = commas(r.clause);
        var has = el('input', { type: 'text', value: commas(r.has), spellcheck: 'false', placeholder: 'nothing required' });
        var lacks = el('input', { type: 'text', value: commas(r.lacks), spellcheck: 'false', placeholder: 'nothing excluded' });
        var W = function (x) { return splitList(x).map(function (y) { return y.toLowerCase().replace(/[^a-z0-9*]+/g, ' ').trim(); }).filter(Boolean); };
        function upd() {
          var d = copy(state.draft.absent_rules);
          d[i] = { label: label.value.trim(), products: splitList(prods.value).map(function (x) { return x.toLowerCase(); }), clause: W(clause.value), has: W(has.value), lacks: W(lacks.value) };
          setDraft('absent_rules', d);
        }
        [label, prods, clause, has, lacks].forEach(function (x) { x.addEventListener('input', upd); });
        function move(by) { var d = copy(state.draft.absent_rules), x = d.splice(i, 1)[0]; d.splice(i + by, 0, x); setDraft('absent_rules', d); draw(); }
        host.appendChild(el('details', { class: 'mr-item mr-prop' },
          el('summary', {}, el('strong', { text: r.label || '(no text)' }), el('span', { class: 'muted', text: ' - ' + (r.products.length ? r.products.join(', ') : 'every product') })),
          el('div', { class: 'mr-prop-grid' },
            el('label', { class: 'field mr-wide' }, el('span', { text: 'The hint says (the reason)' }), label),
            el('label', { class: 'field mr-wide' }, el('span', { text: 'Clause words (commas)' }), clause),
            el('label', { class: 'field' }, el('span', { text: 'Datasheet has one of' }), has),
            el('label', { class: 'field' }, el('span', { text: 'Datasheet has none of' }), lacks),
            el('label', { class: 'field' }, el('span', { text: 'Products (ids)' }), prods)),
          el('div', { class: 'row' },
            i > 0 ? moveBtn('\u2191', 'Move up', function () { move(-1); }) : null,
            i < state.draft.absent_rules.length - 1 ? moveBtn('\u2193', 'Move down', function () { move(1); }) : null,
            moveBtn('Remove', 'Remove this rule', function () { var d = copy(state.draft.absent_rules); d.splice(i, 1); setDraft('absent_rules', d); draw(); }))));
      });
      host.appendChild(el('button', { type: 'button', class: 'btn small', text: 'Add a rule', on: { click: function () {
        var d = copy(state.draft.absent_rules); d.push({ label: 'No ... on the datasheet', products: [V_PRODUCT()], clause: ['word'], has: [], lacks: ['word'] }); setDraft('absent_rules', d); draw();
        var all = host.querySelectorAll('details'); if (all.length) all[all.length - 1].open = true;
      } } }));
    }
    draw();
    cards.__drawAbsent = draw;
    return host;
  }
  // the answers: one per line, in order
  function answersEditor() {
    var ta = el('textarea', { rows: 8, id: 'in-answer_choices', class: 'mr-text', spellcheck: 'false' });
    ta.value = state.draft.answer_choices.join('\n');
    ta.addEventListener('input', function () { setDraft('answer_choices', ta.value.split('\n').map(function (x) { return x.trim().replace(/\s+/g, ' '); }).filter(Boolean)); });
    return el('div', {}, el('label', { for: 'in-answer_choices', class: 'sr-only', text: TITLES.answer_choices }), ta,
      el('p', { class: 'faint small', text: 'One answer per line, in the order of the list. Built-in: ' + S.DEFAULTS.answer_choices.join(', ') }));
  }
  function V_PRODUCT() { return (state.products[0] || {}).id || 'ahu'; }
  function editorFor(key) {
    if (key === 'answer_choices') return answersEditor();
    if (key === 'hint_scope') return boolEditor(key, ' Show "In Contractor\'s Scope?" under the clauses that are the contractor\'s work');
    if (key === 'hint_absent') return boolEditor(key, ' Show "Not Applicable?" under the clauses that ask for something the unit has not');
    if (key === 'scope_parts') return listEditor(key, false);
    if (key === 'scope_words' || key === 'scope_sections' || key === 'scope_manufacturer') return listEditor(key, true);
    if (key === 'absent_rules') return absentEditor();
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
    panels.vocab = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'vocab', hidden: true }, vocabPanel());
    panels.answers = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'answers', hidden: true },
      el('p', { class: 'muted', text: 'The Compliance of a clause is picked from a list - on the record, in Focus mode and in Compliance review - and never typed, so every compliance sheet speaks the same words. Remarks stay free text.' }),
      TABS.answers.map(function (k) { return card(k, editorFor(k)); }));
    panels.hints = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'hints', hidden: true },
      el('p', { class: 'muted', text: 'The compliance is answered as the manufacturer, for the contractor and the consultant. Two answers come up again and again: the contractor\'s work ("In Contractor\'s Scope") and what the unit does not have ("Not Applicable"). These rules put a dotted hint under such clauses; a press on it in Edit answers the clause. A hint is never filled by itself, and an approved library answer of the same clause (green) still comes first.' }),
      TABS.hints.map(function (k) { return card(k, editorFor(k)); }));
    panels.record = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'record', hidden: true }, fixedCard(FIXED[1]));
    panels.fixed = el('div', { class: 'stack', role: 'tabpanel', 'data-panel': 'fixed', hidden: true },
      el('p', { class: 'muted', text: 'What the code still decides on its own. Nothing is hidden: if one of these needs to change, ask for it to be moved to the settings above.' }),
      fixedCard(FIXED[0]), fixedCard(FIXED[2]), fixedCard(FIXED[3]));
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
    else if (key === 'absent_rules' && cards.__drawAbsent) cards.__drawAbsent();
    else if (key === 'answer_choices') { var ta = document.getElementById('in-answer_choices'); if (ta) ta.value = state.draft.answer_choices.join('\n'); }
    else if (key === 'hint_scope' || key === 'hint_absent') { var b = document.getElementById('in-' + key); if (b) b.checked = state.draft[key] !== false; }
    else {
      var input = document.getElementById('in-' + key);
      if (input) input.value = S.NUMBERS[key] ? state.draft[key] : commas(state.draft[key]);
    }
    paintStatus(key); refreshBar(); paintSwitch();
  }

  function showTab(name) {
    [].forEach.call(document.querySelectorAll('#mr-tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== name; });
    if (name === 'history') loadHistory();
    if (name === 'vocab') showVocab();
  }
  $('#mr-tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) showTab(b.getAttribute('data-tab')); });

  /* ---------- the vocabulary (011) ---------- */
  // per product: its items (every item, verified or not: this page is for the reviewers), loaded once and after each change
  var V = { product: null, items: {}, host: null, info: null, list: null, problems: null, ok: true, open: {} };
  var KIND_HELP = { value: 'a figure', class: 'a grade on a scale', standard: 'a test or a code', choice: 'one of some options', presence: 'provided or not' };
  function vocabItems(productId, fresh) {
    if (fresh || !V.items[productId]) {
      V.items[productId] = Api.rpc('projects_vocab_get', { p_product_id: productId }).then(function (r) { V.ok = true; return (r && r.items) || []; },
        function (err) { V.ok = false; delete V.items[productId]; throw err; });
      if (window.PRVocab) window.PRVocab.reload(productId);
    }
    return V.items[productId];
  }
  function productName(id) { var p = state.products.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }

  function vocabPanel() {
    V.product = (state.products[0] || {}).id || 'ahu';
    var pick = el('select', { id: 'vb-product', 'aria-label': 'Product' }, state.products.map(function (p) { return el('option', { value: p.id, text: p.name }); }));
    pick.addEventListener('change', function () { V.product = pick.value; paintSwitch(); showVocab(); });
    var sw = el('input', { type: 'checkbox', id: 'vb-on' });
    sw.addEventListener('change', function () {
      var list = state.draft.vocab_products.filter(function (x) { return x !== V.product; });
      if (sw.checked) list.push(V.product);
      setDraft('vocab_products', list);
    });
    var fb = el('input', { type: 'checkbox', id: 'vb-fallback' });
    fb.addEventListener('change', function () { setDraft('vocab_fallback', fb.checked); });
    V.sw = sw; V.fb = fb;
    V.info = el('p', { class: 'muted', 'aria-live': 'polite' });
    V.problems = el('div');
    V.list = el('div', { class: 'stack' });
    var btn = function (label, fn, kind) { return el('button', { type: 'button', class: 'btn small' + (kind ? ' ' + kind : ''), text: label, on: { click: fn } }); };
    V.tools = el('div', { class: 'row mr-vb-tools' },
      btn('Load the starter vocabulary', loadStarter), btn('Import outline', importOutline), btn('Export outline', exportOutline),
      btn('Verify all', function () { verify(null, true); }), btn('Add a component', function () { addItem('component'); }), btn('Add a standard', function () { addItem('standard'); }));
    return [
      el('p', { class: 'muted', text: 'The old vocabulary map, as a list: for each product the standards specifications cite, the components of the unit and under each component the requirement types - how specifications name them (Terms, Anchors), the unit and which way is better, the class scale, the standards, the options, the words that mean something else (Not), and the datasheet row that answers them (Row). The record recognises what a clause asks by these landmarks (no AI). Nothing is read before it is verified.' }),
      el('section', { class: 'card stack' },
        el('label', { class: 'field mr-vb-product' }, el('span', { text: 'Product' }), pick),
        card('vocab_products', el('label', { class: 'check' }, sw, el('span', { id: 'vb-on-text' }))),
        card('vocab_fallback', el('label', { class: 'check' }, fb, ' Use the Spec keywords for those rows')),
        card('vocab_types', numberEditor('vocab_types')),
        V.info, V.tools, V.problems),
      V.list
    ];
  }
  function paintSwitch() {
    if (!V.sw) return;
    V.sw.checked = state.draft.vocab_products.indexOf(V.product) >= 0;
    V.fb.checked = state.draft.vocab_fallback !== false;
    var t = document.getElementById('vb-on-text'); if (t) t.textContent = ' Match ' + productName(V.product) + ' by its verified vocabulary (saved with Save changes)';
  }

  function showVocab() {
    paintSwitch();
    Core.clear(V.list); V.list.appendChild(el('p', { class: 'muted', text: 'Loading…' }));
    var id = V.product;
    vocabItems(id).then(function (items) { if (id === V.product) drawVocab(items); }, function (err) {
      Core.clear(V.list); V.tools.hidden = true;
      V.list.appendChild(el('p', { class: 'notice warning', text: 'The vocabulary could not be read: ' + Core.errorMessage(err) + ' If SQL 011 (db/projects/011_vocabulary.sql) has not been run yet, run it.' }));
    });
  }

  function drawVocab(items) {
    V.tools.hidden = false; V.lastItems = items;
    var v = window.PRVocab.build(items, true), types = items.filter(function (x) { return x.level === 'type'; });
    var verified = types.filter(function (x) { return x.verified; }).length, waiting = items.filter(function (x) { return !x.verified; }).length;
    var rows = {}; types.forEach(function (t) { if (t.verified) (t.fields.rows || []).forEach(function (r) { rows[window.PRVocab.rowRef(r).key] = 1; }); });
    V.info.textContent = items.length
      ? types.length + ' requirement types (' + verified + ' verified) under ' + items.filter(function (x) { return x.level === 'component'; }).length + ' components, '
        + items.filter(function (x) { return x.level === 'standard'; }).length + ' standards. ' + (waiting ? waiting + ' items wait to be verified. ' : 'Everything is verified. ')
        + Object.keys(rows).length + ' datasheet rows are pointed at by a verified type.'
      : 'No vocabulary for ' + productName(V.product) + ' yet. Load the starter vocabulary (the old tool\'s template) or import an outline.';
    V.tools.querySelector('button').hidden = !(window.PRVocabStarter && window.PRVocabStarter[V.product]);
    Core.clear(V.problems);
    if (v.problems.length) V.problems.appendChild(el('details', { class: 'notice warning' },
      el('summary', { text: v.problems.length + (v.problems.length === 1 ? ' thing to fix' : ' things to fix') }),
      el('ul', { class: 'mr-fixed' }, v.problems.map(function (p) { return el('li', { text: p }); }))));
    Core.clear(V.list);
    var std = items.filter(function (x) { return x.level === 'standard'; });
    if (std.length) V.list.appendChild(group('Standards', null, std));
    items.filter(function (x) { return x.level === 'component'; }).forEach(function (c) {
      V.list.appendChild(group(c.title, c, types.filter(function (t) { return t.component.toLowerCase() === c.title.toLowerCase(); })));
    });
  }
  function badge(it) {
    return it.verified ? el('span', { class: 'badge success', text: 'Verified' }) : el('span', { class: 'badge warning', text: 'To verify' });
  }
  function group(title, comp, list) {
    var key = 'g:' + title.toLowerCase();
    var d = el('details', { class: 'card mr-vb-group' });
    if (V.open[key]) d.open = true;
    d.addEventListener('toggle', function () { V.open[key] = d.open; });
    var waiting = list.filter(function (x) { return !x.verified; }).length + (comp && !comp.verified ? 1 : 0);
    d.appendChild(el('summary', {}, el('strong', { text: title }), el('span', { class: 'muted', text: ' · ' + list.length + (comp ? ' types' : ' standards') }),
      waiting ? el('span', { class: 'badge warning mr-vb-badge', text: waiting + ' to verify' }) : null));
    var body = el('div', { class: 'stack mr-vb-body' });
    if (comp) body.appendChild(itemBox(comp, true));
    list.forEach(function (it) { body.appendChild(itemBox(it, false)); });
    if (comp) body.appendChild(el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn small', text: 'Add a type to ' + comp.title, on: { click: function () { addItem('type', comp.title); } } })));
    d.appendChild(body);
    return d;
  }
  function itemBox(it, isComp) {
    var d = el('details', { class: 'mr-item mr-vb-item' + (isComp ? ' mr-vb-comp' : '') }), built = false, f = it.fields || {};
    var sub = it.level === 'type' ? f.kind + ((f.rows || []).length ? ' · row: ' + f.rows.join('; ') : ' · no datasheet row') : isComp ? 'the component: its words' : (f.terms || []).join(', ');
    d.appendChild(el('summary', {}, el('span', { class: 'mr-vb-title', text: isComp ? 'Component: ' + it.title : it.title }), ' ', badge(it), el('span', { class: 'faint small mr-vb-sub', text: sub })));
    d.addEventListener('toggle', function () { if (d.open && !built) { built = true; d.appendChild(itemForm(it)); } });
    return d;
  }

  // one item's form; a list field is typed with commas (Rows with ";", Equivalents one per line, Scale worst first)
  function itemForm(it) {
    var f = it.fields || {}, inputs = {};
    function text(name, label, value, opts) {
      opts = opts || {};
      var input = opts.area ? el('textarea', { rows: opts.rows || 2, class: 'mr-text', spellcheck: 'false' }) : el('input', { type: 'text', spellcheck: 'false', list: opts.list || null });
      input.value = value == null ? '' : value; inputs[name] = input;
      return el('label', { class: 'field' + (opts.wide ? ' mr-wide' : '') }, el('span', { text: label }), input);
    }
    function select(name, label, value, options) {
      var s = el('select', {}, options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value }); }));
      inputs[name] = s; return el('label', { class: 'field' }, el('span', { text: label }), s);
    }
    var grid = el('div', { class: 'mr-prop-grid' });
    grid.appendChild(text('title', it.level === 'standard' ? 'Standard' : 'Name', it.title));
    if (it.level === 'type') {
      var comps = (V.lastItems || []).filter(function (x) { return x.level === 'component'; }).map(function (x) { return [x.title, x.title]; });
      grid.appendChild(select('component', 'Component', it.component, comps.length ? comps : [[it.component, it.component]]));
      grid.appendChild(select('kind', 'Kind', f.kind, window.PRVocab.KINDS.map(function (k) { return [k, k + ' (' + KIND_HELP[k] + ')']; })));
      grid.appendChild(text('terms', 'Terms: how specifications name it', commas(f.terms), { area: true, wide: true }));
      grid.appendChild(text('anchors', 'Anchors: tokens that point at it alone (L2, IE3, ePM1)', commas(f.anchors), { wide: true }));
      grid.appendChild(text('unit', 'Unit (mm, pa, m3/h, %, h ...)', f.unit));
      grid.appendChild(select('dir', 'Which way is better', f.dir || '', [['', '-'], ['higher', 'Higher is better'], ['lower', 'Lower is better'], ['exact', 'Must match']]));
      grid.appendChild(text('scale', 'Scale, worst first (G3 < G4 < M5)', (f.scale || []).join(' < ')));
      grid.appendChild(text('standards', 'Standards', commas(f.standards), { wide: true }));
      grid.appendChild(text('options', 'Options (for a choice)', commas(f.options), { wide: true }));
      grid.appendChild(text('not', 'Not: words that mean it is something else', commas(f.not), { wide: true }));
      grid.appendChild(text('rows', 'Row: the datasheet rows that answer it (";" between; "#2" = the second row of that key)', (f.rows || []).join('; '), { wide: true, list: 'vb-rows-' + V.product }));
      grid.appendChild(text('equivalents', 'Equivalents, one per line (MERV 13 = F7)', (f.equivalents || []).join('\n'), { area: true, wide: true }));
      grid.appendChild(text('example', 'Example clause', f.example, { area: true, wide: true }));
    } else {
      grid.appendChild(text('terms', it.level === 'component' ? 'Terms: how specifications name the component' : 'Other ways it is written', commas(f.terms), { area: true, wide: true }));
      if (it.level === 'component') grid.appendChild(text('not', 'Not: words that mean it is something else (control panel)', commas(f.not), { wide: true }));
    }
    grid.appendChild(text('note', 'Note (for people)', it.note, { area: true, wide: true }));
    var err = el('p', { class: 'mr-error', role: 'alert', hidden: true });
    function collect() {
      var out = { id: it.id || null, level: it.level, component: it.level === 'type' ? inputs.component.value : '', title: inputs.title.value.trim(), note: inputs.note.value.trim(), fields: {} };
      var L = function (x) { return splitList(x); };
      if (it.level === 'type') {
        out.fields = { kind: inputs.kind.value, terms: L(inputs.terms.value), anchors: L(inputs.anchors.value), unit: inputs.unit.value.trim().toLowerCase().replace(/\s+/g, ''),
          dir: inputs.dir.value, scale: inputs.scale.value.split(/\s*(?:<|,|;)\s*/).map(function (x) { return x.trim(); }).filter(Boolean),
          standards: L(inputs.standards.value), options: L(inputs.options.value), not: L(inputs.not.value),
          rows: inputs.rows.value.split(';').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean),
          equivalents: inputs.equivalents.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean), example: inputs.example.value.trim() };
      } else {
        out.fields = { terms: L(inputs.terms.value) };
        if (it.level === 'component') out.fields.not = L(inputs.not.value);
      }
      if (it.level === 'component') out.component = out.title;
      return out;
    }
    function save(verified) {
      var item = collect(), msg = window.PRVocab.checkItem(item);
      if (msg) { err.textContent = 'Not saved: ' + msg + '.'; err.hidden = false; return; }
      err.hidden = true;
      if (verified != null) item.verified = verified;
      return Api.rpc('projects_vocab_save', { p_product_id: V.product, p_item: item }).then(function () {
        Core.toast(verified ? 'Saved and verified.' : 'Saved.', 'success'); refresh();
      }, function (e) { err.textContent = vocabError(e); err.hidden = false; });
    }
    var b = function (label, fn, cls) { return el('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), text: label, on: { click: function (ev) { Core.busy(ev.currentTarget, fn); } } }); };
    return el('div', { class: 'stack mr-vb-form' }, grid, err,
      el('div', { class: 'row' },
        b('Save', function () { return save(null); }, 'primary'),
        it.id && !it.verified ? b('Save and verify', function () { return save(true); }) : null,
        it.id && it.verified ? b('Back to verify', function () { return verify([it.id], false); }) : null,
        it.id ? b('Remove', function () { return remove(it); }, 'ghost') : null,
        !it.id ? b('Cancel', function () { refresh(); }, 'ghost') : null));
  }
  function vocabError(e) {
    var m = Core.errorMessage(e), code = e && (e.code || e.message) || '';
    if (/INVALID:duplicate/.test(code + m)) return 'Another item has the same name here.';
    if (/INVALID:component/.test(code + m)) return 'Its component is not in the list: add the component first.';
    return m;
  }
  function refresh() {
    var id = V.product;
    return vocabItems(id, true).then(function (items) { V.lastItems = items; if (id === V.product) drawVocab(items); });
  }
  function verify(ids, yes) {
    var go = ids ? Promise.resolve(true) : Core.confirm('Every item of ' + productName(V.product) + ' waiting to be verified is read by the record from now on (when the product is matched by its vocabulary). Check them with Try a clause first.', { title: 'Verify all?', ok: 'Verify all' });
    return go.then(function (ok) {
      if (!ok) return;
      return Api.rpc('projects_vocab_verify', { p_product_id: V.product, p_ids: ids, p_verified: yes }).then(function (r) {
        Core.toast((r && r.changed || 0) + (yes ? ' verified.' : ' back to verify.'), 'success'); return refresh();
      }, function (e) { Core.showError(e); });
    });
  }
  function remove(it) {
    var text = it.level === 'component' ? 'Remove the component "' + it.title + '" and every type under it?' : 'Remove "' + it.title + '"?';
    return Core.confirm(text, { title: 'Remove', ok: 'Remove', danger: true }).then(function (ok) {
      if (!ok) return;
      return Api.rpc('projects_vocab_delete', { p_product_id: V.product, p_ids: [it.id] }).then(function () { Core.toast('Removed.', 'success'); return refresh(); }, function (e) { Core.showError(e); });
    });
  }
  function addItem(level, component) {
    var it = { id: null, level: level, component: component || '', title: '', note: '', verified: false, fields: level === 'type' ? { kind: 'value' } : {} };
    var box = el('section', { class: 'card stack' }, el('h3', { text: level === 'type' ? 'New type under ' + component : level === 'component' ? 'New component' : 'New standard' }), itemForm(it));
    V.list.insertBefore(box, V.list.firstChild);
    box.scrollIntoView({ block: 'start' }); var first = box.querySelector('input'); if (first) first.focus();
  }
  function importItems(items, replace) {
    return Api.rpc('projects_vocab_import', { p_product_id: V.product, p_items: items, p_replace: !!replace }).then(function (r) {
      Core.toast((r.added || 0) + ' added, ' + (r.updated || 0) + ' replaced' + (r.removed ? ', ' + r.removed + ' removed' : '') + '. Everything imported waits to be verified.', 'success');
      return refresh();
    }, function (e) { Core.showError(e); });
  }
  function loadStarter() {
    var items = (window.PRVocabStarter || {})[V.product] || [];
    if (!items.length) return;
    Core.confirm('Adds the old tool\'s ' + productName(V.product) + ' vocabulary: ' + items.filter(function (x) { return x.level === 'type'; }).length + ' requirement types, '
      + items.filter(function (x) { return x.level === 'component'; }).length + ' components and ' + items.filter(function (x) { return x.level === 'standard'; }).length
      + ' standards, all waiting to be verified. An item you already have with the same name is replaced by the starter one (and waits again).', { title: 'Load the starter vocabulary', ok: 'Load' })
      .then(function (ok) { if (ok) return importItems(items, false); });
  }
  function importOutline() {
    var ta = el('textarea', { rows: 12, class: 'mr-text', spellcheck: 'false', placeholder: 'Casing\n  ! Terms: casing, panels\n  Panel thickness\n    ! Kind: value\n    ! Terms: panel thickness\n    ! Unit: mm\n    ! Direction: higher is better\n    ! Row: unit data||panel' });
    var rep = el('input', { type: 'checkbox' }), info = el('p', { class: 'muted small', 'aria-live': 'polite', text: 'Paste an outline: two spaces per level, "> " a note, "! Field: ..." a field (the old map\'s Export).' });
    var parsed = { items: [], problems: [] };
    ta.addEventListener('input', function () {
      parsed = window.PRVocab.fromOutline(ta.value);
      info.textContent = parsed.items.length + ' items read' + (parsed.problems.length ? '; ' + parsed.problems.length + ' lines skipped: ' + parsed.problems.slice(0, 3).join(' ') + (parsed.problems.length > 3 ? ' …' : '') : '') + '. They will wait to be verified.';
    });
    Core.sheet({ title: 'Import outline into ' + productName(V.product), body: el('div', { class: 'stack mr-vb-sheet' }, ta, info, el('label', { class: 'check' }, rep, ' Replace the whole vocabulary of ' + productName(V.product))),
      actions: [{ label: 'Cancel', value: false }, { label: 'Import', kind: 'primary', value: true }] }).then(function (ok) {
      if (!ok) return;
      if (!parsed.items.length) { Core.toast('Nothing to import.', 'danger'); return; }
      return importItems(parsed.items, rep.checked);
    });
  }
  function exportOutline() {
    vocabItems(V.product).then(function (items) {
      var text = window.PRVocab.toOutline(items, productName(V.product));
      var ta = el('textarea', { rows: 14, class: 'mr-text', readonly: true, spellcheck: 'false' }); ta.value = text;
      Core.sheet({ title: 'Outline of ' + productName(V.product), body: el('div', { class: 'stack mr-vb-sheet' }, ta, el('p', { class: 'muted small', text: 'The same outline imports back. Copy it, or download it as a text file.' })),
        actions: [{ label: 'Close', value: false }, { label: 'Download .txt', kind: 'primary', value: true }] }).then(function (dl) {
        if (dl) Core.download('Vocabulary ' + productName(V.product) + ' - outline.txt', new Blob(['﻿' + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }));
      });
    });
  }
  // the mapping rows as suggestions for Row:
  function rowSuggestions() {
    state.products.forEach(function (p) {
      rulesOf(p.id).then(function (rules) {
        if (document.getElementById('vb-rows-' + p.id)) return;
        document.body.appendChild(el('datalist', { id: 'vb-rows-' + p.id }, rules.map(function (r) { return el('option', { value: r.key }); })));
      }, function () {});
    });
  }

  /* Try a clause: what the vocabulary recognises, beside the keywords */
  function tryVocab(productId, text, head, rules) {
    var box = el('div', { class: 'mr-try-vocab' }, el('h3', { text: 'By the vocabulary' }), el('p', { class: 'muted', text: 'Reading the vocabulary…' }));
    tryOut.appendChild(box);
    vocabItems(productId).then(function (items) {
      var v = window.PRVocab.build(items, true), found = window.PRVocab.identify(v, text, head, 10);
      var names = {}; rules.forEach(function (r) { names[r.key] = (String(r.label || '').trim() || r.component) + ' (' + r.section + (r.sub ? ' / ' + r.sub : '') + ')'; });
      var on = state.draft.vocab_products.indexOf(productId) >= 0;
      box.removeChild(box.lastChild);
      box.appendChild(el('p', { class: 'muted', text: (on ? productName(productId) + ' is matched by its vocabulary (on this page). ' : productName(productId) + ' is matched by Spec keywords; this is what the vocabulary would find. ')
        + 'Types still to verify are shown too, marked; the record reads verified types only.' }));
      if (!v.types.length) { box.appendChild(el('p', { class: 'muted', text: 'No vocabulary for ' + productName(productId) + ' yet (tab Vocabulary).' })); return; }
      if (!found.length) { box.appendChild(el('p', { class: 'muted', text: 'No requirement type recognised (each needs a score of ' + window.PRVocab.MIN_SCORE + ' or more).' })); return; }
      box.appendChild(el('ul', { class: 'mr-hits' }, found.map(function (x) {
        var rowsTxt = x.type.rows.length ? x.type.rows.map(function (r) { var ref = window.PRVocab.rowRef(r); return (names[ref.key] || ref.key + ' (not in the row mapping)') + (ref.n ? ' #' + ref.n : ''); }).join('; ') : 'no datasheet row';
        return el('li', {}, el('strong', { text: x.type.title }), ' (' + x.type.component + ') - score ' + x.score + ', ' + x.confidence + (x.asked ? ' · asks: ' + x.asked : ''),
          x.type.verified ? null : el('span', { class: 'badge warning mr-vb-badge', text: 'to verify' }),
          el('span', { class: 'faint small mr-kw', text: 'landmarks: ' + x.landmarks.join(', ') + ' · row: ' + rowsTxt }));
      })));
    }, function (err) { box.removeChild(box.lastChild); box.appendChild(el('p', { class: 'muted', text: 'The vocabulary could not be read: ' + Core.errorMessage(err) })); });
  }

  /* Try a clause: the hints. "In Contractor's Scope?" as on a record; "Not Applicable?" needs a project's datasheet, so the
     rules whose clause words fit are listed with what the datasheet must show. */
  function tryHints(productId, text, head) {
    var part = +($('#try-part') ? $('#try-part').value : 2), section = $('#try-section') ? $('#try-section').value.trim() : '';
    var box = el('div', { class: 'mr-try-vocab' }, el('h3', { text: 'Hints' }));
    var got = window.PRHints.one(text, { part: part, section: section, heading: head, product: productId, sheet: '', values: state.draft });
    var t = window.PRHints.norm(text) + ' ' + window.PRHints.norm(head);
    var fits = state.draft.absent_rules.filter(function (r) {
      return (!r.products.length || r.products.indexOf(productId) >= 0) && r.clause.length && window.PRSettings.topicRegex(r.clause).test(t);
    });
    if (!got.length && !fits.length) box.appendChild(el('p', { class: 'muted', text: 'No hint for this clause.' }));
    if (got.length) box.appendChild(el('ul', { class: 'mr-hits' }, got.map(function (h) { return el('li', {}, el('strong', { text: h.answer + '?' }), ' - ' + h.reason); })));
    if (fits.length) box.appendChild(el('ul', { class: 'mr-hits' }, fits.map(function (r) {
      return el('li', {}, el('strong', { text: 'Not Applicable?' }), ' - ' + r.label + ', when the project\'s datasheet ' +
        [r.has.length ? 'shows one of ' + commas(r.has) : '', r.lacks.length ? 'shows none of ' + commas(r.lacks) : ''].filter(Boolean).join(' and ') + '.');
    })));
    tryOut.appendChild(box);
  }

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
        el('label', { class: 'field' }, el('span', { text: 'Heading above the clause' }), head),
        el('label', { class: 'field' }, el('span', { text: 'Part of the specification' }),
          el('select', { id: 'try-part' }, [2, 1, 3].map(function (n) { return el('option', { value: String(n), text: 'Part ' + n + (n === 1 ? ' (General)' : n === 2 ? ' (Products)' : ' (Execution)') }); }))),
        el('label', { class: 'field' }, el('span', { text: 'Section title' }), el('input', { type: 'text', id: 'try-section', maxlength: 120, placeholder: 'e.g. Installation (optional)' }))),
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
      tryOut.appendChild(el('h3', { text: hits.length ? 'By Spec keywords: the datasheet rows it finds' : 'By Spec keywords: no datasheet row finds it' }));
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
      tryVocab(productId, text, head, rules);
      tryHints(productId, text, head);
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
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (key === 'vocab_products') return v.length ? v.map(productName).join(', ') : 'none (keywords)';
    if (key === 'topics') return v.length + ' topics';
    if (key === 'properties') return v.length + ' properties';
    if (key === 'section_topics') return v.length + ' sections';
    if (key === 'absent_rules') return v.length + ' rules';
    return commas(v);
  }
  // lists of named items: which were added, taken out or changed, by name
  var NAMED = { topics: 'id', properties: 'name', section_topics: 'section', absent_rules: 'label' };
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
    rowSuggestions();
    var want = (window.location.hash || '').replace('#', '');
    if (panels[want]) showTab(want);
  }).catch(function (err) { Core.showError(err); });
})();
