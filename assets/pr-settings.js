/* ============================================================
   Projects - the matching rules (owner, 2026-11-05: "cut the map out; one more button beside Compliance review and
   Product Options, filled with all settings and current assumptions in code; admins review and update it there; no AI,
   no maps").

   The built-in values below are exactly what cm-rows.js and pr-picks.js had written into their code. The reviewers'
   changes are kept in projects.settings (projects_settings_get / projects_settings_save, SQL 010): a key saved there
   replaces the built-in value, a key not saved keeps it. If the settings cannot be read (010 not run yet, offline)
   the built-in values are used, so the record shows the same chips as before.

   PRSettings.DEFAULTS        the built-in values, key by key
   PRSettings.load()          Promise of { values, saved: { key: { by, at } }, can_review } (cached per page)
   PRSettings.merge(saved)    DEFAULTS overlaid by the saved values
   PRSettings.apply(values)   hands them to CMRows.configure and PRPicks.configure (whichever the page has)
   PRSettings.check(key, v)   '' when the value is acceptable, else what is wrong (the database checks the same)
   PRSettings.topicRegex(words)  a topic's word list as the matcher's pattern
   ============================================================ */
(function () {
  'use strict';

  var FAMILIES = ['length', 'mass', 'areal_mass', 'density', 'u_value', 'pressure', 'flow', 'power', 'velocity', 'time', 'temperature'];

  var DEFAULTS = {
    /* ---- 1. Which clause a datasheet row belongs to (cm-rows.js) ---- */
    // parts of a unit, most specific first: a text's topic is the first one it names. "*" = any ending (humidif* = humidifier, humidification)
    topics: [
      { id: 'vfd', words: ['variable frequency', 'variable speed', 'frequency controller', 'frequency controllers', 'vfd', 'vfds', 'vfc', 'vfcs', 'inverter', 'inverters'] },
      { id: 'filter', words: ['filter', 'filters', 'filtration', 'hepa', 'merv'] },
      { id: 'humid', words: ['humidif*', 'washer', 'washers', 'evaporative'] },
      { id: 'heatpipe', words: ['heat pipe', 'heat pipes', 'horseshoe', 'wrap around'] },
      { id: 'recovery', words: ['energy recovery', 'heat recovery', 'heat wheel', 'heat wheels', 'energy wheel', 'energy wheels', 'enthalpy wheel', 'enthalpy wheels',
                                'recuperator', 'recuperators', 'heat exchanger', 'heat exchangers', 'run around'] },
      { id: 'heater', words: ['heater', 'heaters', 'electric heat*', 'electrical heat*', 'heating coil', 'heating coils', 'coil heating', 'coils heating'] },
      { id: 'coil', words: ['coil', 'coils'] },
      { id: 'damper', words: ['damper', 'dampers', 'mixing box', 'mixing boxes', 'mixing section', 'mixing sections'] },
      { id: 'attenuator', words: ['attenuator', 'attenuators', 'silencer', 'silencers'] },
      { id: 'sound', words: ['sound', 'acoustic*', 'noise'] },
      { id: 'fan', words: ['fan', 'fans', 'motor', 'motors', 'drive', 'drives', 'impeller', 'impellers'] },
      { id: 'casing', words: ['casing', 'casings', 'cabinet', 'cabinets', 'panel', 'panels', 'insulation', 'drain pan', 'drain pans', 'door', 'doors',
                              'roof', 'roofs', 'base', 'bases', 'frame', 'frames', 'structural'] },
      { id: 'electrical', words: ['electrical', 'power supply', 'wiring', 'voltage'] },
      { id: 'performance', words: ['capacity', 'capacities', 'characteristics', 'performance'] }
    ],
    // a heading that names only these does not decide a clause's topic: the clause's own label does
    general_topics: ['casing', 'performance'],
    // datasheet sections that name no part of the unit, and the topics their rows belong to; any other section: the topics its name holds
    section_topics: [
      { section: 'unit data', how: 'is', topics: ['casing', 'performance'] },
      { section: 'mechanical characteristic', how: 'starts', topics: ['casing'] },
      { section: 'en 13053', how: 'starts', topics: ['performance', 'fan'] }
    ],
    parts: [2, 1],               // searched in this order; the next Part only for a row the earlier one has nothing for; a Part not listed is never searched
    near_words: 6,               // the words of one keyword entry may stand at most this many other words apart in the clause
    max_clauses: 3,              // clauses shown per datasheet row
    keep_share: 50,              // a clause scoring below this % of the best clause for the row is dropped
    heading_words: 8,            // a line of at most this many words (brackets not counted) and without the words below is a heading
    heading_verbs: ['shall', 'must', 'will', 'should'],
    label_chars: 80,             // "Fan motor: ..." - the text before a colon this near the start is the clause's own label

    /* ---- 2. What to select from Product Options (pr-picks.js) ---- */
    // which way is better for a figure or a class, by the words around it; the longest matching term wins
    properties: [
      { name: 'panel thickness', terms: ['panel thickness', 'casing thickness', 'panel', 'casing', 'skin', 'wall thickness'], direction: 'higher', unit: 'length', scale: [] },
      { name: 'insulation thickness', terms: ['insulation', 'insulated', 'foam', 'polyurethane', 'mineral wool', 'rock wool'], direction: 'higher', unit: 'length', scale: [] },
      { name: 'sheet or tube thickness', terms: ['gauge', 'sheet thickness', 'tube thickness', 'fin thickness', 'wall of tube'], direction: 'higher', unit: 'length', scale: [] },
      { name: 'density', terms: ['density'], direction: 'higher', unit: '', scale: [] },
      { name: 'thermal transmittance (U value)', terms: ['u value', 'u-value', 'thermal transmittance', 'thermal conductance', 'conductance', 'w/m2k', 'w/m²k'], direction: 'lower', unit: 'u_value', scale: [] },
      { name: 'pressure drop', terms: ['pressure drop', 'pressure loss', 'air side resistance', 'resistance'], direction: 'lower', unit: 'pressure', scale: [] },
      { name: 'air leakage', terms: ['leakage', 'leak', 'air tightness'], direction: 'lower', unit: '', scale: [] },
      { name: 'sound level', terms: ['sound power', 'sound pressure', 'sound level', 'noise', 'acoustic level'], direction: 'lower', unit: '', scale: [] },
      { name: 'air velocity', terms: ['face velocity', 'velocity', 'air speed'], direction: 'lower', unit: 'velocity', scale: [] },
      { name: 'specific fan power', terms: ['specific fan power', 'sfp'], direction: 'lower', unit: '', scale: [] },
      { name: 'efficiency', terms: ['efficiency', 'efficient', 'cop', 'eer', 'iplv', 'nplv', 'seer'], direction: 'higher', unit: '', scale: [] },
      { name: 'capacity', terms: ['capacity', 'cooling capacity', 'heating capacity', 'duty'], direction: 'higher', unit: 'power', scale: [] },
      { name: 'air flow', terms: ['air flow', 'airflow', 'air volume', 'flow rate'], direction: 'higher', unit: 'flow', scale: [] },
      { name: 'motor power', terms: ['absorbed power', 'power input', 'power consumption', 'motor power'], direction: 'lower', unit: 'power', scale: [] },
      { name: 'warranty', terms: ['warranty', 'guarantee'], direction: 'higher', unit: 'time', scale: [] },
      { name: 'electrical supply', terms: ['voltage', 'power supply', 'electrical supply', 'phase', 'volt'], direction: 'exact', unit: '', scale: [] },
      { name: 'connection size', terms: ['connection size', 'connection', 'nozzle', 'flange size'], direction: 'exact', unit: 'length', scale: [] },
      { name: 'thermal bridging class (EN 1886)', terms: ['thermal bridging', 'thermal bridge', 'tb class', 'tb'], direction: 'higher', unit: '', scale: ['TB5', 'TB4', 'TB3', 'TB2', 'TB1'] },
      { name: 'thermal transmittance class (EN 1886)', terms: ['thermal transmittance class', 'transmittance class', 'thermal transmittance', 'thermal transmit', 't class'], direction: 'higher', unit: '', scale: ['T5', 'T4', 'T3', 'T2', 'T1'] },
      { name: 'casing strength class (EN 1886)', terms: ['mechanical strength', 'casing strength', 'deflection', 'd class'], direction: 'higher', unit: '', scale: ['D3', 'D2', 'D1'] },
      { name: 'casing leakage class (EN 1886)', terms: ['casing leakage', 'casing air leakage', 'air leakage class', 'leakage class', 'l class'], direction: 'higher', unit: '', scale: ['L3', 'L2', 'L1'] },
      { name: 'filter class (EN 779)', terms: ['filter class', 'filtration', 'filter', 'filters'], direction: 'higher', unit: '',
        scale: ['G1', 'G2', 'G3', 'G4', 'M5', 'M6', 'F7', 'F8', 'F9', 'E10', 'E11', 'E12', 'H10', 'H11', 'H12', 'H13', 'H14', 'U15', 'U16', 'U17'] }
    ],
    figure_words: 8,             // a figure in the clause belongs to a row when one of the row's keywords stands within this many words of it
    option_values: 40,           // approved values kept per row (most seen first)
    candidates_shown: 12,        // values carried to the Selection list per row
    choose_listed: 3,            // values named in a "choose:" or "none seen meets it" chip

    /* ---- 3. The vocabulary (011, pr-vocab.js) ---- */
    vocab_products: [],          // products matched by their verified vocabulary; a row no verified type points at keeps its Spec keywords
    vocab_fallback: true         // a row the vocabulary covers but finds no clause for in this specification: its Spec keywords are used
  };

  var ORDER = Object.keys(DEFAULTS);
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---------- checks (the database makes the same ones: projects.settings_check) ---------- */
  var NUMBERS = { near_words: [0, 30], max_clauses: [1, 10], keep_share: [0, 100], heading_words: [1, 30], label_chars: [10, 200],
                  figure_words: [1, 40], option_values: [1, 300], candidates_shown: [1, 100], choose_listed: [1, 20] };
  var ID = /^[a-z][a-z0-9_]{0,29}$/, WORD = /^[a-z0-9]+\*?( [a-z0-9]+\*?)*$/;
  function strList(v, max, each) { return Array.isArray(v) && v.length <= max && v.every(function (s) { return typeof s === 'string' && each(s); }); }
  function check(key, v) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return 'unknown setting';
    if (NUMBERS[key]) {
      var r = NUMBERS[key];
      return typeof v === 'number' && Math.floor(v) === v && v >= r[0] && v <= r[1] ? '' : 'a whole number from ' + r[0] + ' to ' + r[1];
    }
    if (key === 'topics') {
      if (!Array.isArray(v) || !v.length || v.length > 40) return '1 to 40 topics';
      var ids = {};
      for (var i = 0; i < v.length; i++) {
        var t = v[i];
        if (!t || typeof t !== 'object' || !ID.test(t.id || '')) return 'topic ' + (i + 1) + ': a short name of small letters (e.g. filter)';
        if (ids[t.id]) return 'the topic "' + t.id + '" is listed twice';
        ids[t.id] = 1;
        if (!strList(t.words, 80, function (s) { return s.length <= 60 && WORD.test(s); }) || !t.words.length)
          return 'topic "' + t.id + '": 1 to 80 words or phrases of small letters and digits, "*" only at a word end';
      }
      return '';
    }
    if (key === 'general_topics') return strList(v, 40, function (s) { return ID.test(s); }) ? '' : 'topic names';
    if (key === 'section_topics') {
      if (!Array.isArray(v) || v.length > 60) return 'at most 60 lines';
      for (var j = 0; j < v.length; j++) {
        var s = v[j];
        if (!s || typeof s !== 'object' || typeof s.section !== 'string' || !/^[a-z0-9]+( [a-z0-9]+)*$/.test(s.section) || s.section.length > 80)
          return 'line ' + (j + 1) + ': the section name in small letters and digits';
        if (s.how !== 'is' && s.how !== 'starts') return 'line ' + (j + 1) + ': "is" or "starts with"';
        if (!strList(s.topics, 20, function (x) { return ID.test(x); }) || !s.topics.length) return 'line ' + (j + 1) + ': one or more topics';
      }
      return '';
    }
    if (key === 'parts') {
      return Array.isArray(v) && v.length >= 1 && v.length <= 5 && v.every(function (n, k) { return typeof n === 'number' && Math.floor(n) === n && n >= 1 && n <= 9 && v.indexOf(n) === k; })
        ? '' : '1 to 5 different Part numbers from 1 to 9';
    }
    if (key === 'vocab_fallback') return typeof v === 'boolean' ? '' : 'yes or no';
    if (key === 'vocab_products') {
      return Array.isArray(v) && v.length <= 20 && v.every(function (s, i) { return typeof s === 'string' && /^[a-z0-9_-]{1,40}$/.test(s) && v.indexOf(s) === i; }) ? '' : 'product ids';
    }
    if (key === 'heading_verbs') return strList(v, 20, function (s) { return /^[a-z]{2,20}$/.test(s); }) ? '' : 'single words of small letters';
    if (key === 'properties') {
      if (!Array.isArray(v) || !v.length || v.length > 80) return '1 to 80 properties';
      for (var k = 0; k < v.length; k++) {
        var p = v[k], at = 'property ' + (k + 1) + ': ';
        if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) return at + 'a name up to 80 characters';
        if (!strList(p.terms, 30, function (s) { return s.length >= 1 && s.length <= 60 && s === s.toLowerCase() && s.trim() === s; }) || !p.terms.length) return at + '1 to 30 words in small letters';
        if (['higher', 'lower', 'exact'].indexOf(p.direction) < 0) return at + 'higher, lower or exact';
        if (p.unit !== '' && FAMILIES.indexOf(p.unit) < 0) return at + 'a kind of figure from the list';
        if (!strList(p.scale, 30, function (s) { return /^[A-Z]{1,3}[0-9]{1,2}$/.test(s); })) return at + 'classes such as G4, F7, TB2, worst first';
      }
      return '';
    }
    return '';
  }

  /* a topic's words as the matcher's pattern: whole words, "*" = any ending; texts are compared in small letters with
     every run of other characters as one space, so "heat pipes?" and "heat pipe; heat pipes" find the same */
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function topicRegex(words) {
    var alts = words.map(function (w) { return w.split(' ').map(function (x) { var star = /\*$/.test(x); return esc(x.replace(/\*$/, '')) + (star ? '\\w*' : ''); }).join(' '); });
    return new RegExp('\\b(' + alts.join('|') + ')\\b');
  }

  function merge(saved) {
    var out = copy(DEFAULTS);
    Object.keys(saved || {}).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && !check(k, saved[k])) out[k] = copy(saved[k]); });
    return out;
  }

  function apply(values) {
    if (window.CMRows && window.CMRows.configure) window.CMRows.configure(values);
    if (window.PRPicks && window.PRPicks.configure) window.PRPicks.configure(values);
  }

  var loaded = null;
  function load() {
    if (loaded) return loaded;
    var get = window.Api && window.Api.prSettings ? window.Api.prSettings() : Promise.reject(new Error('no settings'));
    loaded = get.then(function (r) {
      var saved = {}, meta = {};
      ((r && r.settings) || []).forEach(function (s) { saved[s.key] = s.value; meta[s.key] = { by: s.updated_by_name || '', at: s.updated_at || '' }; });
      var values = merge(saved);
      apply(values);
      return { values: values, saved: meta, can_review: !!(r && r.can_review), ok: true };
    }, function () {
      // 010 not run yet, or the network failed: the built-in values, as before
      var values = copy(DEFAULTS); apply(values);
      return { values: values, saved: {}, can_review: false, ok: false };
    });
    return loaded;
  }

  window.PRSettings = { DEFAULTS: DEFAULTS, ORDER: ORDER, FAMILIES: FAMILIES, NUMBERS: NUMBERS, check: check, merge: merge, apply: apply,
                        load: load, topicRegex: topicRegex, reload: function () { loaded = null; return load(); } };
})();
