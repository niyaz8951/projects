/* ============================================================
   Projects - what to select, from the factory's approved Product Options (the dashed chips and the Selection list).
   A port to the browser of the old tool's worker/src/ai/evidence.ts (requirements, compareDatasheet, optionPicks,
   picksFor), ai/compare.ts (units, properties, classes), ai/guard.ts (measurements), ai/rules.ts (parentOf) and
   lib/po-kind.ts (poKind), 2026-11-05: the owner keeps one matcher in the browser, so the picks are worked out
   here beside the blue chips (pr-match.js + cm-rows.js) instead of on the server. No AI: code compares.

   PRPicks.build({ lines, match, approved }) -> { by_seq: { seq: [pick, ...] }, rows: [group, ...], factory }
     lines     the record's lines as projects_run_get gives them (seq, type, sr, spec, can)
     match     PRMatch.load's result (its table, rules and hasNotes)
     approved  projects_po_approved's result for the record's factory
   A pick: { key, section, component, required: [text], status: 'meets' | 'not seen' | 'choose', pick, times,
             candidates: [{ value, times }], reason, exact }
   A group (the Selection list): { key, section, component, candidates, lines: [{ seq, sr, spec, required, status, pick, reason }] }
   Per row (owner, 2026-11-05): a clause gets a pick for a row only when the project has no datasheet value for it.
   The properties (which way is better), the class scales and the numbers below are the built-in values; the reviewers
   change them on the Matching rules page (pr-settings.js, PRPicks.configure).
   ============================================================ */
(function () {
  'use strict';

  /* ---------- measurements (guard.ts) ---------- */
  var UNIT_LIST = [
    'met(?:er|re)s?\\s+per\\s+second', 'per\\s?cent',
    'inch(?:es)?\\s+(?:of\\s+)?(?:water(?:\\s+gauge|\\s+column)?|w\\.?\\s?g\\.?|w\\.?\\s?c\\.?)', 'in\\.?\\s?w\\.?g\\.?', 'inch(?:es)?',
    'w\\s?\\/\\s?\\(?\\s?(?:square\\s+met(?:er|re)|sq\\.?\\s?m|m2|m²)\\.?\\s?(?:k|°c|deg\\s?c)\\)?',
    'kg\\s?\\/\\s?(?:square\\s+met(?:er|re)|sq\\.?\\s?m|m2|m²)', 'kg\\s?\\/\\s?(?:cubic\\s+met(?:er|re)|cu\\.?\\s?m|m3|m³)',
    'degrees?\\s+(?:celsius|fahrenheit|c|f)', 'millimet(?:er|re)s?', 'met(?:er|re)s?', 'feet', 'foot', 'ft', 'pounds?', 'lbs?',
    'mm', 'cm', 'm', 'km', 'kg', 'g', 't', 'kw', 'w', 'mw', 'kwr', 'tr', 'btu\\/h', 'btuh', 'kcal\\/h', 'pa', 'kpa', 'bar', 'psi', '%',
    'micron', 'microns', 'µm', 'um', '°c', 'deg\\s?c', 'c', '°f', 'f', 'db', 'dba', 'db\\(a\\)', 'm\\/s', 'fpm', 'm3\\/h', 'm³\\/h', 'cmh',
    'l\\/s', 'lps', 'cfm', 'rpm', 'hz', 'v', 'vac', 'a', 'amp', 'amps', 'hours', 'hrs', 'h', 'years', 'yrs', 'ip\\d{2}'
  ];
  var UNIT_RE = UNIT_LIST.slice().sort(function (a, b) { return b.replace(/\\/g, '').length - a.replace(/\\/g, '').length; }).join('|');
  var MEASURE_SRC = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?!\\d)|\\d+(?:[.,]\\d+)?)\\s*-?\\s*(' + UNIT_RE + ')(?![a-z0-9])';
  var STANDARD_BEFORE = /\b(NFPA|UL|ASHRAE|AHRI|ARI|AMCA|ASTM|SMACNA|ANSI|ISO|IEC|EN|BS|DIN|SASO)[\s-]*$/i;
  var ALIAS = { degc: 'c', microns: 'micron', um: 'micron', 'µm': 'micron', hrs: 'h', hours: 'h', yrs: 'years', lps: 'l/s', cmh: 'm3/h', amps: 'a', amp: 'a', vac: 'v', btuh: 'btu/h', 'db(a)': 'dba' };
  function unitKey(u) {
    var s = u.toLowerCase().replace(/\s+/g, '').replace(/³/g, '3').replace(/²/g, '2').replace(/°/g, '');
    if (/^met(er|re)s?persecond$/.test(s)) return 'm/s';
    if (/^percent$/.test(s)) return '%';
    if (/^(inch|inches|in)\.?(of)?(water|w\.?g|w\.?c)/.test(s)) return 'in.wg';
    if (/^inch(es)?$/.test(s)) return 'in';
    if (/^w\/\(?(squaremet(er|re)|sq\.?m|m2)\.?(k|c|degc)\)?$/.test(s)) return 'w/m2k';
    if (/^kg\/(squaremet(er|re)|sq\.?m|m2)$/.test(s)) return 'kg/m2';
    if (/^kg\/(cubicmet(er|re)|cu\.?m|m3)$/.test(s)) return 'kg/m3';
    if (/^degrees?(celsius|c)$/.test(s)) return 'c';
    if (/^degrees?(fahrenheit|f)$/.test(s)) return 'f';
    if (/^millimet(er|re)s?$/.test(s)) return 'mm';
    if (/^met(er|re)s?$/.test(s)) return 'm';
    if (/^(feet|foot|ft)$/.test(s)) return 'ft';
    if (/^(pound|pounds|lb|lbs)$/.test(s)) return 'lb';
    return ALIAS[s] || s;
  }
  function measurements(text) {
    var out = [], re = new RegExp(MEASURE_SRC, 'gi'), m, s = String(text == null ? '' : text);
    while ((m = re.exec(s))) {
      var unit = m[2];
      if (/^[cfahtg]$/i.test(unit) && /\s/.test(m[0])) continue;
      if (/^[a-z]$/i.test(unit) && STANDARD_BEFORE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
      var num = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m[1]) ? m[1].replace(/,/g, '') : m[1].replace(',', '.');
      out.push({ n: parseFloat(num), unit: unitKey(unit), raw: m[0].trim() });
    }
    return out;
  }

  /* ---------- units, properties and classes (compare.ts) ---------- */
  var FAMILIES = {
    length: { mm: 1, cm: 10, m: 1000, km: 1e6, 'in': 25.4, ft: 304.8 },
    mass: { g: 0.001, kg: 1, t: 1000, lb: 0.45359237 },
    areal_mass: { 'kg/m2': 1 }, density: { 'kg/m3': 1 }, u_value: { 'w/m2k': 1 },
    pressure: { pa: 1, kpa: 1000, bar: 1e5, psi: 6894.757, 'in.wg': 249.0889, inwg: 249.0889 },
    flow: { 'm3/h': 1, 'l/s': 3.6, cfm: 1.699011 },
    power: { w: 0.001, kw: 1, kwr: 1, mw: 1000, tr: 3.516853, 'btu/h': 0.00029307107, 'kcal/h': 0.001163 },
    velocity: { 'm/s': 1, fpm: 0.00508 },
    time: { h: 1, years: 8760 }
  };
  function familyOf(unit) {
    for (var f in FAMILIES) if (Object.prototype.hasOwnProperty.call(FAMILIES[f], unit)) return f;
    return unit === 'c' || unit === 'f' ? 'temperature' : null;
  }
  function convert(m, to) {
    if (m.unit === to) return m.n;
    var f = familyOf(m.unit);
    if (!f || f !== familyOf(to)) return null;
    if (f === 'temperature') return to === 'c' ? (m.n - 32) * 5 / 9 : m.n * 9 / 5 + 32;
    var units = FAMILIES[f];
    return m.n * units[m.unit] / units[to];
  }
  function fmt(n) { var r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100; return r.toLocaleString('en-US'); }

  var PROPERTIES = [
    { name: 'panel thickness', terms: ['panel thickness', 'casing thickness', 'panel', 'casing', 'skin', 'wall thickness'], direction: 'higher', unit: 'length' },
    { name: 'insulation thickness', terms: ['insulation', 'insulated', 'foam', 'polyurethane', 'mineral wool', 'rock wool'], direction: 'higher', unit: 'length' },
    { name: 'sheet or tube thickness', terms: ['gauge', 'sheet thickness', 'tube thickness', 'fin thickness', 'wall of tube'], direction: 'higher', unit: 'length' },
    { name: 'density', terms: ['density'], direction: 'higher' },
    { name: 'thermal transmittance (U value)', terms: ['u value', 'u-value', 'thermal transmittance', 'thermal conductance', 'conductance', 'w/m2k', 'w/m²k'], direction: 'lower', unit: 'u_value' },
    { name: 'pressure drop', terms: ['pressure drop', 'pressure loss', 'air side resistance', 'resistance'], direction: 'lower', unit: 'pressure' },
    { name: 'air leakage', terms: ['leakage', 'leak', 'air tightness'], direction: 'lower' },
    { name: 'sound level', terms: ['sound power', 'sound pressure', 'sound level', 'noise', 'acoustic level'], direction: 'lower' },
    { name: 'air velocity', terms: ['face velocity', 'velocity', 'air speed'], direction: 'lower', unit: 'velocity' },
    { name: 'specific fan power', terms: ['specific fan power', 'sfp'], direction: 'lower' },
    { name: 'efficiency', terms: ['efficiency', 'efficient', 'cop', 'eer', 'iplv', 'nplv', 'seer'], direction: 'higher' },
    { name: 'capacity', terms: ['capacity', 'cooling capacity', 'heating capacity', 'duty'], direction: 'higher', unit: 'power' },
    { name: 'air flow', terms: ['air flow', 'airflow', 'air volume', 'flow rate'], direction: 'higher', unit: 'flow' },
    { name: 'motor power', terms: ['absorbed power', 'power input', 'power consumption', 'motor power'], direction: 'lower', unit: 'power' },
    { name: 'warranty', terms: ['warranty', 'guarantee'], direction: 'higher', unit: 'time' },
    { name: 'electrical supply', terms: ['voltage', 'power supply', 'electrical supply', 'phase', 'volt'], direction: 'exact' },
    { name: 'connection size', terms: ['connection size', 'connection', 'nozzle', 'flange size'], direction: 'exact', unit: 'length' },
    { name: 'thermal bridging class (EN 1886)', terms: ['thermal bridging', 'thermal bridge', 'tb class', 'tb'], direction: 'higher', scale: ['TB5', 'TB4', 'TB3', 'TB2', 'TB1'] },
    { name: 'thermal transmittance class (EN 1886)', terms: ['thermal transmittance class', 'transmittance class', 'thermal transmittance', 'thermal transmit', 't class'], direction: 'higher', scale: ['T5', 'T4', 'T3', 'T2', 'T1'] },
    { name: 'casing strength class (EN 1886)', terms: ['mechanical strength', 'casing strength', 'deflection', 'd class'], direction: 'higher', scale: ['D3', 'D2', 'D1'] },
    { name: 'casing leakage class (EN 1886)', terms: ['casing leakage', 'casing air leakage', 'air leakage class', 'leakage class', 'l class'], direction: 'higher', scale: ['L3', 'L2', 'L1'] },
    { name: 'filter class (EN 779)', terms: ['filter class', 'filtration', 'filter', 'filters'], direction: 'higher',
      scale: ['G1', 'G2', 'G3', 'G4', 'M5', 'M6', 'F7', 'F8', 'F9', 'E10', 'E11', 'E12', 'H10', 'H11', 'H12', 'H13', 'H14', 'U15', 'U16', 'U17'] }
  ];
  function hay(text) { return ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9²/.-]+/g, ' ').replace(/\s+/g, ' ') + ' '; }
  function propertyOf(text, opts) {
    opts = opts || {};
    var h = hay(text), best = null, len = 0;
    PROPERTIES.forEach(function (p) {
      if (opts.classed !== undefined && !!p.scale !== opts.classed) return;
      if (opts.family && p.unit && p.unit !== opts.family) return;
      p.terms.forEach(function (t) { if (t.length > len && h.indexOf(' ' + t + ' ') >= 0) { best = p; len = t.length; } });
    });
    return best;
  }
  function judge(required, actual, p) {
    if (Math.abs(actual - required) < 1e-9 * Math.max(1, Math.abs(required))) return 'equal';
    if (!p) return 'unknown';
    if (p.direction === 'exact') return 'differs';
    var up = actual > required;
    return (p.direction === 'higher') === up ? 'better' : 'worse';
  }
  var CLASS_RE = /\b(TB[1-5]|T[1-5]|D[1-3]|L[1-3]|[GMFEHU]\d{1,2})\b/g;
  var FIG = 8, OPT_MAX = 40, CANDS = 12, LISTED = 3;
  function classTokens(text) { var seen = {}, out = []; (String(text || '').toUpperCase().match(CLASS_RE) || []).forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } }); return out; }
  function compareClass(required, actual, p) {
    if (!p || !p.scale) return null;
    var ri = p.scale.indexOf(required.toUpperCase()), ai = p.scale.indexOf(actual.toUpperCase());
    if (ri < 0 || ai < 0) return null;
    return ai === ri ? 'equal' : ai > ri ? 'better' : 'worse';
  }
  function classRequirements(clause) {
    var h = hay(clause), out = [];
    classTokens(clause).forEach(function (cls) {
      var prop = null;
      PROPERTIES.some(function (x) { if (x.scale && x.scale.indexOf(cls) >= 0 && x.terms.some(function (t) { return t.length > 2 && h.indexOf(' ' + t + ' ') >= 0; })) { prop = x; return true; } return false; });
      if (prop) out.push({ cls: cls, prop: prop });
    });
    return out;
  }
  function classIn(cell, p) { var hit = null; classTokens(cell).some(function (c) { if (p.scale.indexOf(c) >= 0) { hit = c; return true; } return false; }); return hit; }
  function comparable(cell, req) {
    var ms = measurements(cell);
    for (var i = 0; i < ms.length; i++) { var v = convert(ms[i], req.unit); if (v !== null) return { m: ms[i], value: v, converted: ms[i].unit !== req.unit }; }
    return null;
  }
  var METRICS = [
    ['arrestance', /\barrestance\b/], ['coarse', /\bcoarse\b/], ['epm1', /\bepm\s?1\b/], ['epm2.5', /\bepm\s?2\.?5\b/], ['epm10', /\bepm\s?10\b/],
    ['merv', /\bmerv\b/], ['dust spot', /\bdust[- ]spot\b/], ['efficiency', /\b(efficien\w*|effectiveness)\b/], ['humidity', /\b(humidity|rh)\b/],
    ['recirculation', /\brecircul\w*\b/], ['leakage', /\bleak\w*\b/], ['slope', /\bslope\b/], ['speed', /\bspeed\b/], ['torque', /\btorque\b/]
  ];
  function metricsIn(text) {
    var t = String(text || '').toLowerCase(), out = METRICS.filter(function (x) { return x[1].test(t); }).map(function (x) { return x[0]; });
    return out.length > 1 ? out.filter(function (k) { return k !== 'efficiency'; }) : out;
  }
  function sameMetric(clauseNear, rowText) {
    var a = metricsIn(clauseNear), b = metricsIn(rowText);
    return !a.length || !b.length || a.some(function (x) { return b.indexOf(x) >= 0; });
  }

  /* ---------- the requirements a clause states (evidence.ts) ---------- */
  var NOT_LESS = /(?:not|never|no)\s+(?:be\s+)?(?:less|lower|fewer|smaller|thinner)\s+than\s*$/i;
  var OPS_MAX = /(?:maximum(?:\s+of)?|max\.?|at\s+most|up\s+to|limited\s+to|not\s+(?:to\s+|be\s+)?exceed(?:ing)?|(?:not|never|no)\s+(?:be\s+)?(?:more|greater|higher|larger|bigger|over)(?:\s+than)?|less\s+than|lower\s+than|below|under|≤|<=|=<)\s*$/i;
  var OPS_MIN = /(?:minimum(?:\s+of)?|min\.?|at\s+least|no\s+less\s+than|shall\s+exceed|exceeding|greater\s+than|more\s+than|higher\s+than|above|over|≥|>=|=>)\s*$/i;
  var AFTER_MIN = /^\s*(or more|or greater|or higher|or above|or better|minimum|min\b)/i;
  var AFTER_MAX = /^\s*(or less|or lower|or below|or smaller|maximum|max\b)/i;
  var REFUSED = /^\s*(?:[a-z.]+\s+){0,3}?(?:will|shall|is|are|must)\s+not\s+(?:be\s+)?(?:permitted|accepted|acceptable|allowed)\b/i;
  var BELOW_WORD = /(?:less|lower|smaller|thinner|fewer|below|under)(?:\s+than)?\s*$/i;
  var ABOVE_WORD = /(?:more|greater|higher|larger|thicker|above|over|exceed(?:s|ing)?)(?:\s+than)?\s*$/i;
  function operatorOf(before, after) {
    var b = before.replace(/\s+/g, ' ');
    if (REFUSED.test(after)) { if (BELOW_WORD.test(b)) return '>='; if (ABOVE_WORD.test(b)) return '<='; }
    if (NOT_LESS.test(b)) return '>=';
    if (OPS_MAX.test(b)) return '<=';
    if (OPS_MIN.test(b)) return '>=';
    if (AFTER_MIN.test(after)) return '>=';
    if (AFTER_MAX.test(after)) return '<=';
    if (/\b(?:maximum|max\.?)\s+(?:[a-z][a-z-]*\s+){1,3}$/i.test(b)) return '<=';
    if (/\b(?:minimum|min\.?)\s+(?:[a-z][a-z-]*\s+){1,3}$/i.test(b)) return '>=';
    return '=';
  }
  function tokensWithPos(text) { var out = [], re = /[a-z0-9]+/gi, m; while ((m = re.exec(text))) out.push({ w: m[0].toLowerCase(), at: m.index }); return out; }
  var CONDITION_BEFORE = /\b(?:at|@|exposed\s+to|subjected\s+to|tested\s+(?:at|to)|test\s+pressure\s+of)\s*[-+±]?\s*$/i;
  function isCondition(clause, m, at, op, classAsked) {
    var before = clause.slice(Math.max(0, at - 40), at);
    if (CONDITION_BEFORE.test(before)) return true;
    var sentence = before.split(/[.;:]\s/).pop() || '';
    var cond = /\b(if|when|whenever|unless)\b/i.exec(sentence);
    if (cond && !/\b(shall|must)\b/i.test(sentence.slice(cond.index))) return true;
    return classAsked && op === '=' && familyOf(m.unit) === 'pressure';
  }
  function requirements(clause) {
    var out = [], ms = [], from = 0;
    measurements(clause).forEach(function (m) { var at = clause.indexOf(m.raw, from); if (at < 0) return; from = at + m.raw.length; ms.push({ m: m, at: at }); });
    var prevEnd = -1;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i].m, at = ms[i].at;
      var dup = prevEnd >= 0 && /^\s*\(\s*$/.test(clause.slice(prevEnd, at));
      prevEnd = at + m.raw.length;
      if (dup) continue;
      var before = clause.slice(Math.max(0, at - 40), at), after = clause.slice(at + m.raw.length, at + m.raw.length + 25);
      var bare = /(?:between\s+)?(\d+(?:[.,]\d+)?)\s*(?:to|and|-|–)\s*$/i.exec(before);
      if (bare && !/\d\s*$/.test(before.slice(0, bare.index))) { out.push({ m: m, op: 'range', at: at, lo: parseFloat(bare[1].replace(',', '.')) }); continue; }
      var next = ms[i + 1];
      if (next && next.m.unit === m.unit && /^\s*(?:to|and|-|–)\s*$/i.test(clause.slice(at + m.raw.length, next.at))) {
        out.push({ m: next.m, op: 'range', at: at, lo: m.n }); prevEnd = next.at + next.m.raw.length; i++; continue;
      }
      out.push({ m: m, op: operatorOf(before, after), at: at });
    }
    var classAsked = classRequirements(clause).length > 0;
    out.forEach(function (r) { if (isCondition(clause, r.m, r.at, r.op, classAsked)) r.condition = true; });
    return out;
  }

  /* ---------- which dimension a length figure is ---------- */
  var DIMS = [
    ['diameter', /^(diameters?|dia|od|bore)$/], ['spacing', /^(spacing|spaced|space|pitch|fpi)$/], ['height', /^(heights?|high|tall)$/],
    ['width', /^(widths?|wide)$/], ['length', /^(lengths?|long)$/], ['depth', /^(depths?|deep)$/], ['thickness', /^(thickness|thick|gauge)$/]
  ];
  function dimOfWord(w) { for (var i = 0; i < DIMS.length; i++) if (DIMS[i][1].test(w)) return DIMS[i][0]; return ''; }
  function wordsOf(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); }
  function clauseDimension(clause, at, raw) {
    var before = wordsOf(clause.slice(Math.max(0, at - 80), at)).slice(-6).reverse();
    var after = wordsOf(clause.slice(at + raw.length, at + raw.length + 30)).slice(0, 2);
    var best = '', dist = Infinity;
    before.forEach(function (w, i) { var d = dimOfWord(w); if (d && i < dist) { best = d; dist = i; } });
    after.forEach(function (w, i) { var d = dimOfWord(w); if (d && i < dist) { best = d; dist = i; } });
    return best;
  }
  function rowDimension(label) {
    var ws = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    for (var i = ws.length - 1; i >= 0; i--) { var d = dimOfWord(ws[i]); if (d) return d; }
    var l = ' ' + ws.join(' ') + ' ';
    if (/ dimensions? | size /.test(l)) return 'size';
    if (/ base /.test(l)) return 'height';
    if (/ (panel|skin|insulation|sheet|fin material|tube) /.test(l)) return 'thickness';
    return '';
  }
  function sameDimension(clauseDim, rowDim) { return clauseDim === rowDim || (rowDim === 'size' && ['height', 'width', 'length', 'depth'].indexOf(clauseDim) >= 0); }

  /* strict (the chip mark): a whole keyword entry must stand near the figure (or in the heading above), and an entry
     that is only a dimension word ("thick") does not count - "16 mm thick isocyanate foam" under a drain pan is not
     the casing panel. Without strict (the picks) any keyword word will do, as in the old tool. */
  var DIM_WORD = /^(thick|thickness|depth|deep|width|wide|length|long|height|high|size|sizes|dimension|dimensions|gauge|diameter|dia)$/;
  function near(clause, at, entries, subject, strict) {
    var toks = tokensWithPos(clause), k = -1;
    for (var i = 0; i < toks.length; i++) if (toks[i].at >= at) { k = i; break; }
    if (k < 0) return false;
    var lo = Math.max(0, k - FIG), hi = Math.min(toks.length, k + FIG), keys = [];
    if (strict) {
      var pool = toks.slice(lo, hi).map(function (t) { return t.w; }).concat(subject ? tokensWithPos(subject).map(function (t) { return t.w; }) : []);
      return entries.some(function (e) {
        var ws = e.filter(function (w) { return w.length >= 3 && !/^\d/.test(w); });
        if (!ws.length || (ws.length === 1 && DIM_WORD.test(ws[0]))) return false;
        return ws.every(function (w) { return pool.some(function (t) { return t.indexOf(w) === 0; }); });
      });
    }
    entries.forEach(function (e) { e.forEach(function (w) { if (w.length >= 3 && !/^\d/.test(w)) keys.push(w); }); });
    for (var j = lo; j < hi; j++) if (keys.some(function (w) { return toks[j].w.indexOf(w) === 0; })) return true;
    if (subject) { var st = tokensWithPos(subject); for (var q = 0; q < st.length; q++) if (keys.some(function (w) { return st[q].w.indexOf(w) === 0; })) return true; }
    return false;
  }
  function subjectOf(parent) {
    var p = String(parent || '').trim();
    if (!p) return '';
    var colon = p.indexOf(':');
    return (colon > 0 && colon <= 60 ? p.slice(0, colon) : p.split(/\s+/).slice(0, 8).join(' ')).trim();
  }

  /* ---------- the clause's figures and classes against datasheet rows (compareDatasheet) ---------- */
  function compareDatasheet(clause, hits, columns, subject) {
    var reqs = requirements(clause).filter(function (r) { return !r.condition; }), classes = classRequirements(clause);
    if ((!reqs.length && !classes.length) || !hits.length) return null;
    var used = [], vals = [], open = 0, all = [];
    function where(h, unit, many) { return many || columns.length > 1 ? unit : h.component; }
    function settle(list) {
      var groups = {};
      list.forEach(function (v) { if (v.group) (groups[v.group] = groups[v.group] || []).push(v); });
      for (var g in groups) {
        var rows = [], ok = false, bad = false;
        groups[g].forEach(function (v) { if (rows.indexOf(v.hit) < 0) rows.push(v.hit); if (v.ok) ok = true; else bad = true; });
        if (rows.length > 1 && ok && bad) return false;
      }
      return list.length > 0;
    }
    reqs.forEach(function (r) {
      var mine = [];
      hits.forEach(function (h) {
        if (!near(clause, r.at, h.entries, subject, h.strict)) return;
        if (familyOf(r.m.unit) === 'length') { var want = clauseDimension(clause, r.at, r.m.raw); if (want && !sameDimension(want, rowDimension(h.label))) return; }
        var around = clause.slice(Math.max(0, r.at - 60), r.at + r.m.raw.length + 10);
        if (r.m.unit === '%' && !sameMetric(around, h.label + ' ' + h.cells.join(' '))) return;
        var perUnit = h.cells.map(function (c, i) { return { unit: columns[i] || 'unit ' + (i + 1), got: comparable(c, r.m) }; }).filter(function (x) { return x.got; });
        if (!perUnit.length) return;
        var prop = propertyOf(h.label + ' ' + clause.slice(Math.max(0, r.at - 80), r.at + 40), { family: familyOf(r.m.unit), classed: false });
        perUnit.forEach(function (u) {
          var m = u.got.m, v = u.got.value, converted = u.got.converted;
          var ok = r.op === '>=' ? v >= r.m.n - 1e-9 : r.op === '<=' ? v <= r.m.n + 1e-9 : r.op === 'range' ? v >= r.lo - 1e-9 && v <= r.m.n + 1e-9 : true;
          var j = r.op === '=' ? judge(r.m.n, v, prop) : 'equal', equal = j === 'equal';
          var sign = r.op === '=' ? (equal ? '=' : '≠') : r.op === 'range' ? (ok ? 'within' : 'outside') : ok ? (r.op === '>=' ? '≥' : '≤') : (r.op === '>=' ? '<' : '>');
          var shown = converted ? m.raw + ' (' + fmt(v) + ' ' + r.m.unit + ')' : m.raw;
          var asked = r.op === 'range' ? fmt(r.lo) + ' to ' + r.m.raw : r.m.raw;
          var how = r.op === '=' && !equal && prop ? (j === 'better' ? ', better for ' + prop.name : j === 'worse' ? ', worse for ' + prop.name : ', ' + prop.name + ' must match') : '';
          mine.push({ ok: ok, equal: equal, op: r.op, worse: j === 'worse' || j === 'differs', j: j, group: h.group || '', hit: h, m: m,
            text: shown + ' ' + sign + ' ' + asked + (r.op === '=' ? ' asked' : ' required') + how + ' (' + where(h, u.unit, perUnit.length > 1) + ')' });
        });
      });
      if (!settle(mine)) { open++; return; }
      mine.forEach(function (v) { all.push(v); if (used.indexOf(v.hit) < 0) used.push(v.hit); vals.push(v.m); });
    });
    classes.forEach(function (c) {
      var mine = [];
      hits.forEach(function (h) {
        var perUnit = h.cells.map(function (cell, i) { return { unit: columns[i] || 'unit ' + (i + 1), cls: classIn(cell, c.prop) }; }).filter(function (x) { return x.cls; });
        perUnit.forEach(function (u) {
          var j = compareClass(c.cls, u.cls, c.prop);
          if (!j) return;
          var ok = j !== 'worse';
          mine.push({ ok: ok, equal: j === 'equal', op: '>=', worse: !ok, j: j, group: h.group || '', hit: h,
            text: u.cls + ' ' + (j === 'equal' ? '=' : ok ? 'better than' : 'worse than') + ' ' + c.cls + ' required on the ' + c.prop.name + ' scale (' + where(h, u.unit, perUnit.length > 1) + ')' });
        });
      });
      if (!settle(mine)) { open++; return; }
      mine.forEach(function (v) { all.push(v); if (used.indexOf(v.hit) < 0) used.push(v.hit); });
    });
    if (!all.length) return null;
    var broken = all.filter(function (v) { return !v.ok; }), differs = all.filter(function (v) { return v.op === '=' && !v.equal; });
    // a clause that also asks things the datasheet does not show is not judged as a whole - but the chip mark
    // (partial) judges only this row's figures
    if (open && !broken.length && !hits.some(function (h) { return h.partial; })) return null;
    var compliance = broken.length ? 'Not Comply' : differs.length ? 'Comply with Remarks' : 'Comply';
    var offered = used.map(function (h) { return h.value; }).filter(Boolean).join('; ');
    var remarks = compliance === 'Comply' ? '' : offered;
    var shownT = (broken.length ? broken : differs.length ? differs : all).slice(0, 4).map(function (v) { return v.text; });
    var confidence = !broken.length && differs.some(function (v) { return v.worse; }) ? 'low' : compliance === 'Comply with Remarks' ? 'medium' : 'high';
    return { compliance: compliance, remarks: remarks, rows: used, values: vals, confidence: confidence,
             checks: all.map(function (v) { return { ok: v.ok, equal: v.equal, worse: v.worse, op: v.op, j: v.j, text: v.text }; }),
             reason: 'From the datasheet: ' + shownT.join('; ') + (all.length > 4 ? ' …' : '') + '.' + (compliance === 'Comply' && offered ? ' Offered: ' + offered + '.' : '') +
               (open ? ' ' + open + ' other part' + (open === 1 ? '' : 's') + ' of the clause not on the datasheet.' : '') +
               (confidence === 'low' ? ' The offer is below what is asked: check before it goes out.' : '') };
  }

  /* ---------- no datasheet value: the closest approved Product Options value (optionPicks) ---------- */
  var OPS = { '>=': '≥ ', '<=': '≤ ', '=': '', range: '' };
  function optionPicks(clause, rows, values, subject) {
    var reqs = requirements(clause).filter(function (r) { return !r.condition; }), classes = classRequirements(clause);
    return rows.map(function (row) {
      var cands = values[row.key] || [];
      var required = reqs.filter(function (r) { return near(clause, r.at, row.entries, subject); }).map(function (r) { return (r.op === 'range' ? fmt(r.lo) + ' to ' : OPS[r.op] || '') + r.m.raw; })
        .concat(classes.map(function (c) { return c.cls + ' (' + c.prop.name + ')'; }));
      var base = { key: row.key, section: row.section, component: row.component, required: required, candidates: cands.slice(0, CANDS) };
      var meets = [], fails = 0;
      cands.forEach(function (v) {
        var hit = { key: row.key, section: row.section, component: row.component, label: row.section + ' • ' + row.component, cells: [v.value], value: v.value, entries: row.entries };
        var c = compareDatasheet(clause, [hit], ['Product Options'], subject);
        if (!c) return;
        if (c.compliance === 'Not Comply' || c.confidence === 'low') { fails++; return; }
        var dist = Infinity;
        for (var i = 0; i < reqs.length; i++) { var g = comparable(v.value, reqs[i].m); if (g) { dist = Math.abs(g.value - reqs[i].m.n); break; } }
        meets.push({ v: v, exact: c.compliance === 'Comply', dist: dist });
      });
      meets.sort(function (a, b) { return (a.exact === b.exact ? 0 : a.exact ? -1 : 1) || (a.dist - b.dist) || (b.v.times - a.v.times); });
      var list = cands.slice(0, LISTED).map(function (x) { return x.value + ' (' + x.times + '×)'; }).join(', ') + (cands.length > LISTED ? ' and ' + (cands.length - LISTED) + ' more' : '');
      var asked = required.join(', ') || 'the clause';
      if (meets.length) {
        var p = meets[0].v, exact = meets[0].exact;
        return Object.assign(base, { status: 'meets', pick: p.value, times: p.times, exact: exact, reason: p.value + ' (seen ' + p.times + '×) ' + (exact ? 'meets' : 'is the closest higher value to') + ' ' + asked });
      }
      if (fails) return Object.assign(base, { status: 'not seen', pick: '', times: 0, exact: false, reason: 'none of the values seen (' + list + ') meets ' + asked + ': ask the factory' });
      if (cands.length === 1) return Object.assign(base, { status: 'choose', pick: cands[0].value, times: cands[0].times, exact: false, reason: cands[0].value + ' (the only value seen, ' + cands[0].times + '×)' });
      return Object.assign(base, { status: 'choose', pick: '', times: 0, exact: false, reason: cands.length ? 'choose: ' + list : 'no value seen for this factory yet' });
    });
  }

  /* ---------- the parent clause (rules.ts) ---------- */
  function level(sr) {
    var s = String(sr || '').trim();
    if (/^[A-Z][.)]?$/.test(s)) return 1;
    if (/^\d{1,2}[.)]?$/.test(s)) return 2;
    if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)[.)]?$/.test(s)) return 4;
    if (/^[a-z][.)]?$/.test(s)) return 3;
    if (/^\(\w{1,3}\)$/.test(s)) return 4;
    return 0;
  }
  function parentOf(rows, i) {
    if (i < 0 || i >= rows.length) return '';
    var me = rows[i], lvl = level(me.sr), j, r, l;
    if (lvl === 0 && me.type !== 'part' && me.type !== 'section') {
      for (j = i - 1; j >= 0 && j >= i - 40; j--) { r = rows[j]; if (r.type === 'section' || r.type === 'part') return ''; l = level(r.sr); if (l === 1 || l === 2) return r.spec.trim().slice(0, 600); }
      return '';
    }
    if (lvl < 2) return '';
    for (j = i - 1; j >= 0 && j >= i - 40; j--) { r = rows[j]; if (r.type === 'section' || r.type === 'part') return ''; l = level(r.sr); if (l > 0 && l < lvl) return r.spec.trim().slice(0, 600); }
    return '';
  }

  /* ---------- what a datasheet row is, for Product Options (po-kind.ts) ---------- */
  var PROJECT = /^unit data\|\|(location|air density|altitude)\s*(\([^)]*\))?$/;
  var DUTY_SUB = /(^|\W)(winter|summer|cooling|heating)(\W|$)|air side|fluid side/;
  var DUTY = new RegExp(['flow', 'pressure(?! drop design)', 'velocity', 'capacity', 'heat transfer', '\\btemp\\b', 'temperature', 'humidity',
    '\\bpower\\b(?! supply)', 'current', 'speed work', 'efficiency(?! class| epm)', '\\beff\\.', 'weight', 'length', 'width', 'height',
    '\\barea\\b', 'torque', 'volume', '\\bsfp', 'steam', 'voltage', 'recirculated', 'dimensions', '\\brows\\b', 'circuit',
    'connection diam', 'quantity', 'steps number', 'distributor', 'pmref', 'power class', 'velocity class', 'energy class \\(en13053\\)', '^model$'].join('|'));
  var FCU_SECTION = /^(configuration information|cooling coil \((cooling|heating) mode\)|acoustical performance|sound pressure level\b.*)$/;
  var FCU_UNIT_OPTION = /^(unit model|(net|shipping) dimension\b.*|unit net weight\b.*)$/;
  var FCU_UNIT_DUTY = /^((application|design) (air flow|esp)\b.*|fan power input\b.*|running current\b.*|fan speed)$/;
  var FCU_HEATER_DUTY = /^(heating capacity\b.*|e-heater maximum current\b.*|(on|off) coil \(db\).*)$/;
  function fcuKind(section, component) {
    if (section === 'unit data') return FCU_UNIT_OPTION.test(component) ? 'option' : FCU_UNIT_DUTY.test(component) ? 'duty' : null;
    if (section === 'electric heater') return FCU_HEATER_DUTY.test(component) ? 'duty' : null;
    if (!FCU_SECTION.test(section)) return null;
    if (section === 'configuration information') return /^face velocity\b/.test(component) ? 'duty' : 'option';
    if (/^cooling coil/.test(section)) return /^coil rows$/.test(component) ? 'option' : 'duty';
    return 'duty';
  }
  function poAutoKind(rowKey) {
    var p = rowKey.split('|'), section = p[0] || '', sub = p[1] || '', component = p[2] || '';
    if (/^options$/.test(sub) && component === 'option') return 'accessory';
    if (component === 'note' || /[[\]]/.test(component)) return 'hide';
    if (PROJECT.test(rowKey)) return 'project';
    if (section === 'nrvu') return /outdoor conditions/.test(component) ? 'project' : /^(typology|drive type|hrs type|external leakage|filter energy|filter service)/.test(component) ? 'option' : 'duty';
    if (section === 'electrical power inputs') return component === 'electrical connection' ? 'option' : 'duty';
    var fcu = fcuKind(section, component);
    if (fcu) return fcu;
    if (/^coil\b/.test(section) && component === 'model') return 'hide';
    if (/^en ?13053$/.test(section)) return 'duty';
    if (/^(fan\b|.*\bfan$)/.test(section) && component === 'model') return 'option';
    if (section === 'unit data' && component === 'model') return 'duty';
    if (DUTY_SUB.test(sub) || DUTY.test(component)) return 'duty';
    return 'option';
  }
  function poKind(rowKey, override) {
    var auto = poAutoKind(rowKey);
    if (auto === 'accessory' || auto === 'hide') return auto;
    return override === 'option' || override === 'duty' ? override : auto;
  }

  /* ---------- the mark on a blue chip: what the datasheet value is against what the clause asks ----------
     owner, 2026-11-05 ("start with 1"): "50 mm asked · 62 mm offered ✓ better". The same comparison as the picks:
     figures with their operator and unit (converted), classes on their scale, the dimension of a length, the
     nearness of the row's words. Returns null when the clause asks no figure or class this row can be compared with.
     o: { clause, key, section, component, cells, columns, keywords, terms, specRows, index }
     -> { kind: 'meets' | 'better' | 'check' | 'below', mark, reason } */
  function verdict(o) {
    var entries = String(o.keywords || '').split(';').map(wordsList).filter(function (e) { return e.length; });
    (o.terms || []).forEach(function (x) { var e = wordsList(x); if (e.length) entries.push(e); });
    if (!entries.length) return null;
    var comp = String(o.component || '').replace(/\s\u00b7.*$/, '');
    var hit = { key: o.key, section: o.section, component: comp, label: o.section + ' \u2022 ' + comp, cells: o.cells || [], entries: entries,
                value: (o.cells || []).filter(function (x) { return x && x !== '-'; }).join('; '), strict: true, partial: true };
    var subject = o.specRows && o.index != null ? subjectOf(parentOf(o.specRows, o.index)) : '';
    var c = compareDatasheet(o.clause, [hit], o.columns && o.columns.length ? o.columns : ['unit'], subject);
    if (!c || !c.checks || !c.checks.length) return null;
    // below: outside a minimum / maximum / range, or on the worse side of a property with a direction (75 mm asked,
    // 62 mm offered); check: must match and differs (a voltage), or no property says which way is better
    var k = c.checks, kind = k.some(function (x) { return !x.ok || x.j === 'worse'; }) ? 'below'
      : k.some(function (x) { return x.j === 'differs' || x.j === 'unknown'; }) ? 'check'
      : k.some(function (x) { return !x.equal; }) ? 'better' : 'meets';
    var MARK = { meets: '\u2713 meets', better: '\u2713 better', check: '\u2260 check', below: '\u2717 not met' };
    return { kind: kind, mark: MARK[kind], reason: c.reason };
  }

  /* ---------- the record's picks: per clause, the rows it is about that have no datasheet value ---------- */
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function wordsList(s) { var n = norm(s); return n ? n.split(' ') : []; }
  function build(o) {
    var lines = o.lines || [], match = o.match, approved = o.approved || { values: [] };
    var rules = {}; (match && match.rules || []).forEach(function (r) { rules[r.key] = r; });
    // approved values per mapping row (duty figures, project conditions and hidden rows are not options), merged
    // without regard to case, most seen first, at most 40 per row
    var values = {};
    (approved.values || []).forEach(function (v) {
      var kind = poKind(v.key, v.kind);
      if (kind === 'duty' || kind === 'project' || kind === 'hide') return;
      var p = values[v.key] || (values[v.key] = []), same = null;
      p.some(function (x) { if (x.value.toLowerCase() === v.value.toLowerCase()) { same = x; return true; } return false; });
      if (same) same.times += v.times; else if (p.length < OPT_MAX) p.push({ value: v.value, times: v.times, group: v.grp || '' });
    });
    Object.keys(values).forEach(function (k) { values[k].sort(function (a, b) { return b.times - a.times; }); });
    // the mapping rows each clause is about (the same match as the chips), where the project gives no value
    var rowsOf = {}, specRows = lines.map(function (l) { return { seq: l.seq, type: l.type, sr: l.sr, spec: l.spec }; });
    (match && match.table || []).forEach(function (r) {
      if (r.kind !== 'row' || !r.found) return;
      if (match.hasNotes && window.PRMatch.hasValue(r)) return;      // the datasheet answers it: a blue chip, not a pick
      var rule = rules[r.key], entries = String(rule && rule.keywords || '').split(';').map(wordsList).filter(function (e) { return e.length; });
      // a row found by the vocabulary: its types' words count as keywords too (011)
      (r.terms || []).forEach(function (x) { var e = wordsList(x); if (e.length) entries.push(e); });
      (r.lines || []).forEach(function (i) {
        var l = rowsOf[i] || (rowsOf[i] = []);
        if (!l.some(function (x) { return x.key === r.key; })) l.push({ key: r.key, section: r.section, component: String(rule && rule.label || '').trim() || r.component.replace(/\s·.*$/, ''), entries: entries });
      });
    });
    var bySeq = {}, groups = {};
    Object.keys(rowsOf).forEach(function (i) {
      var line = lines[+i]; if (!line || !line.can) return;
      var picks = optionPicks(line.spec, rowsOf[i], values, subjectOf(parentOf(specRows, +i)));
      picks.forEach(function (pk) {
        var g = groups[pk.key] || (groups[pk.key] = { key: pk.key, section: pk.section, component: pk.component, candidates: pk.candidates, lines: [] });
        g.lines.push({ seq: line.seq, sr: line.sr, spec: line.spec.slice(0, 300), required: pk.required, status: pk.status, pick: pk.pick, reason: pk.reason });
        (bySeq[line.seq] = bySeq[line.seq] || []).push({ component: pk.component, status: pk.status, pick: pk.pick, reason: pk.reason, key: pk.key });
      });
    });
    var order = {}; (match && match.rules || []).forEach(function (r, i) { order[r.key] = i; });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return ((order[a.key] === undefined ? 1e9 : order[a.key]) - (order[b.key] === undefined ? 1e9 : order[b.key])) || a.key.localeCompare(b.key); });
    return { by_seq: bySeq, rows: list, factory: approved.factory || '', has_sheet: !!(match && match.hasNotes) };
  }

  /* The Matching rules page's values (PRSettings.merge). The class pattern is built from the scales, so a class a
     reviewer adds to a scale is found in the clauses too. */
  function configure(v) {
    if (!v) return;
    if (v.properties) {
      PROPERTIES = v.properties.map(function (p) {
        var o = { name: p.name, terms: p.terms.slice(), direction: p.direction };
        if (p.unit) o.unit = p.unit;
        if (p.scale && p.scale.length) o.scale = p.scale.slice();
        return o;
      });
      var cls = [];
      PROPERTIES.forEach(function (p) { (p.scale || []).forEach(function (c) { if (cls.indexOf(c) < 0) cls.push(c); }); });
      cls.sort(function (a, b) { return b.length - a.length; });
      CLASS_RE = cls.length ? new RegExp('\\b(' + cls.join('|') + ')\\b', 'g') : /(?!)/g;
    }
    if (v.figure_words != null) FIG = v.figure_words;
    if (v.option_values != null) OPT_MAX = v.option_values;
    if (v.candidates_shown != null) CANDS = v.candidates_shown;
    if (v.choose_listed != null) LISTED = v.choose_listed;
  }

  window.PRPicks = { build: build, configure: configure, verdict: verdict, propertyOf: propertyOf, classRequirements: classRequirements, classTokens: classTokens, familyOf: familyOf, measurements: measurements, requirements: requirements, compareDatasheet: compareDatasheet, optionPicks: optionPicks,
                     poKind: poKind, poAutoKind: poAutoKind, parentOf: parentOf, subjectOf: subjectOf, fmt: fmt, convert: convert };
})();
