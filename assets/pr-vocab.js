/* ============================================================
   Projects - the vocabulary: what a clause asks, recognised by its landmarks (owner, 2026-11-05: "these matching rules
   can better match using what we had done for vocabulary in maps" - "yes go ahead"). No AI, no map.

   A port to the browser of the old tool's worker/src/ai/vocab.ts (parseVocab, identify) with the data kept in the tile
   (projects.vocab, SQL 011) instead of a vocabulary map. Per product: standards, components (Terms, Not) and under each
   component the requirement types:
     Kind (value | class | standard | choice | presence), Terms, Anchors, Unit, Direction, Scale (worst first),
     Standards, Options, Not, Rows (the datasheet rows that answer it; "#2" = the second row of that key, e.g. Filter 2),
     Equivalents ("MERV 13 = F7"), Example.
   identify() scores every type on the landmarks it finds (rare property words, component in the clause or its heading,
   anchors and scale classes, the standard, a figure in the type's unit near its words, options; minus for Not words and
   for a clause that names other components) and keeps the types scoring 3.5 or more, best first.

   PRVocab.build(items, all)       items as projects_vocab_get gives them -> { types, components, standards, problems }
                                    (only verified items unless all)
   PRVocab.identify(v, clause, section, max)  -> [{ type, score, confidence, landmarks, level, asked }]
   PRVocab.match(specRows, rules, v, values)  -> the rows of CMRows.match, the rows a verified type points at found by
                                    the vocabulary (with .nth for "#n" rows), every other row by its Spec keywords
   PRVocab.load(productId)         Promise of the verified vocabulary of a product (cached per page)
   PRVocab.toOutline(items) / fromOutline(text)   the old map's outline: two spaces per level, "> " note, "! Field: ..."
   PRVocab.checkItem(item)         '' or what is wrong (projects.vocab_check checks the same)
   ============================================================ */
(function () {
  'use strict';
  var KINDS = ['value', 'class', 'standard', 'choice', 'presence'];
  var LISTS = ['terms', 'anchors', 'scale', 'standards', 'options', 'not', 'rows', 'equivalents'];
  var MIN_SCORE = 3.5;

  function P() { return window.PRPicks; }

  /* ---------- the vocabulary from its items ---------- */
  function build(items, all) {
    var out = { types: [], components: [], standards: [], problems: [] }, comps = {};
    (items || []).forEach(function (it) {
      if (!all && !it.verified) return;
      var f = it.fields || {};
      if (it.level === 'standard') out.standards.push({ name: it.title, terms: [it.title].concat(f.terms || []) });
      else if (it.level === 'component') {
        var c = { title: it.title, terms: (f.terms || []).length ? f.terms.slice() : [it.title.toLowerCase()], not: (f.not || []).slice() };
        out.components.push(c); comps[it.title.toLowerCase()] = c;
      }
    });
    var ids = {};
    (items || []).forEach(function (it) {
      if (it.level !== 'type' || (!all && !it.verified)) return;
      var f = it.fields || {}, where = '"' + it.component + ' › ' + it.title + '"' + (it.verified ? '' : ' (to verify)');
      if (!comps[String(it.component).toLowerCase()]) { out.problems.push(where + ': its component is not in the list (or not verified), so it is not read.'); return; }
      var t = { id: it.id, title: it.title, component: comps[it.component.toLowerCase()].title, kind: f.kind, terms: f.terms || [], anchors: f.anchors || [],
                unit: String(f.unit || '').toLowerCase().replace(/\s+/g, ''), dir: f.dir || '', scale: f.scale || [], standards: f.standards || [],
                options: f.options || [], not: f.not || [], rows: f.rows || [], equivalents: f.equivalents || [], example: f.example || '', verified: !!it.verified };
      if (!t.terms.length && !t.anchors.length) out.problems.push(where + ' has no Terms and no Anchors: no clause can find it.');
      if (t.kind === 'class' && t.scale.length < 2) out.problems.push(where + ' is a class with no Scale (worst < ... < best).');
      if (t.kind === 'value' && t.unit && !P().familyOf(t.unit) && ['%', 'db', 'dba', 'rpm', 'hz', 'v', 'a', 'kg/m3', 'w/m2k', 'h', 'years'].indexOf(t.unit) < 0)
        out.problems.push(where + ': Unit "' + t.unit + '" is not one the code reads; figures cannot be compared.');
      if (t.kind === 'value' && !t.dir) out.problems.push(where + ': Direction is missing (higher, lower or exact): a figure cannot be judged.');
      if (t.kind === 'choice' && !t.options.length) out.problems.push(where + ' is a choice with no Options.');
      var key = (t.component + '.' + t.title).toLowerCase();
      if (ids[key]) out.problems.push(where + ': another type has the same name under ' + t.component + '.');
      ids[key] = 1; out.types.push(t);
    });
    return out;
  }

  /* ---------- recognising a clause (vocab.ts identify) ---------- */
  // lower case; hyphens are spaces ("double-skin" = "double skin"); a full stop ends a word, a decimal point does not
  function norm(s) {
    return ' ' + String(s || '').toLowerCase().replace(/[\u2010-\u2015-]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/[^a-z0-9.%/+²³µ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }
  var reCache = {};
  function termRe(term) {
    var re = reCache[term];
    if (!re) {
      var t = norm(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s?');
      re = reCache[term] = new RegExp('(?:^| )' + t + '(?:s|es|ed|ing)?(?= |$)');
    }
    return re;
  }
  function find(h, terms) {
    var out = [];
    (terms || []).forEach(function (term) { if (!term) return; var m = termRe(term).exec(h); if (m) out.push({ term: term, at: m.index, end: m.index + m[0].length }); });
    // one stretch of the clause counts once: the longest term that covers it ("casing leakage" over "leakage")
    return out.filter(function (x) {
      return !out.some(function (y) {
        return y !== x && y.at <= x.at + 1 && y.end >= x.end - 1 && ((y.end - y.at > x.end - x.at) || (y.end - y.at === x.end - x.at && out.indexOf(y) < out.indexOf(x)));
      });
    });
  }
  var OPS = { '>=': 'at least ', '<=': 'at most ', '=': '', range: '' };
  // words that name a property of many parts: they count only beside the type's component
  var GENERIC = ['stainless steel', 'rating', 'ratings', 'rated', 'capacity', 'diameter', 'length', 'lock', 'locks', 'depth', 'deep', 'width', 'wide'];
  function idf(v) {
    if (v._idf) return v._idf;
    var df = {}, n = Math.max(v.types.length, 1), out = {};
    v.types.forEach(function (t) {
      var seen = {};
      t.terms.concat(t.anchors).forEach(function (x) { var w = x.toLowerCase(); if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } });
    });
    Object.keys(df).forEach(function (w) { out[w] = 1 + Math.log(n / df[w]); });
    Object.defineProperty(v, '_idf', { value: out, enumerable: false });
    return out;
  }

  /* keep (optional): only types it accepts take one of the max places (match: types that point at a datasheet row) */
  function identify(v, clause, section, max, keep) {
    max = max || 3;
    if (!v || !v.types.length || !clause) return [];
    var w = idf(v), h = norm(clause), hs = norm(section || '');
    var reqs = P().requirements(clause), classes = P().classTokens(clause);
    var stdHits = v.standards.filter(function (s) { return find(h, s.terms).length; }).map(function (s) { return s.name.toLowerCase(); });
    var compHit = {};
    v.components.forEach(function (c) {
      var neg = find(h, c.not).length > 0;
      compHit[c.title] = { inClause: !neg && find(h, c.terms).length > 0, inSection: find(hs, c.terms).length > 0, neg: neg };
    });
    // the components the clause itself names (not "unit": every clause is about the unit)
    var named = v.components.filter(function (c) { return compHit[c.title].inClause && !/^unit$/i.test(c.title); }).map(function (c) { return c.title; });
    var low = clause.toLowerCase(), out = [];
    v.types.forEach(function (t) {
      var marks = [], score = 0, prop = 0;
      var c = compHit[t.component] || { inClause: false, inSection: false, neg: false };
      var pt = find(h, t.terms).filter(function (x) { return GENERIC.indexOf(x.term.toLowerCase()) < 0 || c.inClause || c.inSection; });
      // property words: the rarest weigh most, but one rare word alone never outweighs the structure of the clause
      pt.slice().sort(function (a, b) { return (w[b.term.toLowerCase()] || 1) - (w[a.term.toLowerCase()] || 1); }).slice(0, 2)
        .forEach(function (x, i) { var s = Math.min(w[x.term.toLowerCase()] || 1, 4) * (i ? 0.6 : 2); score += s; prop += s; marks.push(x.term); });
      // anchors: an anchor of the type, or a class of its scale, written in the clause
      var scaleHits = t.kind === 'class' ? t.scale.filter(function (s) { return s.length >= 2 && termRe(s).test(h); }) : [];
      var an = find(h, t.anchors).map(function (x) { return x.term; })
        .concat(scaleHits.filter(function (s) { return !t.anchors.some(function (a) { return a.toLowerCase() === s.toLowerCase(); }); }));
      if (c.inClause) { score += 2; marks.push(t.component.toLowerCase()); } else if (c.inSection) { score += 1.2; marks.push('section: ' + t.component.toLowerCase()); }
      if (an.length) {
        // a short anchor (L2, T2, G4) counts in full only beside another landmark of its type
        var strong = an.some(function (a) { return a.length >= 3; }) || prop > 0 || c.inClause || c.inSection;
        score += strong ? 3 : 0.8; marks.push.apply(marks, an.slice(0, 2));
      }
      if (!prop && !an.length) return;                                        // a component alone is not a requirement
      if (c.inClause || c.inSection) score += 1.5;                             // the pair: component + property
      if (named.length && !c.inClause && named.indexOf(t.component) < 0 && !/^unit$/i.test(t.component)) score -= c.inSection ? 1.5 : 3;
      var std = t.standards.filter(function (s) { return stdHits.indexOf(s.toLowerCase()) >= 0 || termRe(s).test(h); });
      if (std.length) { score += 1.5; marks.push(std[0]); }
      // a figure in the type's unit
      var measure = null;
      if (t.kind === 'value' && t.unit) {
        var fam = P().familyOf(t.unit), db = function (u) { return u === 'db' || u === 'dba'; };
        var fit = reqs.filter(function (r) { return r.m.unit === t.unit || (fam && P().familyOf(r.m.unit) === fam) || (db(t.unit) && db(r.m.unit)); });
        if (fit.length) {
          var at = pt.length ? Math.max(0, low.indexOf(pt[0].term.toLowerCase().split(' ')[0])) : -1;
          measure = fit.slice().sort(function (a, b) { return Math.abs(a.at - at) - Math.abs(b.at - at); })[0];
          var near = at >= 0 && Math.abs(measure.at - at) <= 40;
          score += near ? 4 : 1.5; marks.push(measure.m.raw);
        } else if (reqs.length) score -= 1;                                    // figures in other units: likely another type
      }
      if (find(h, t.not).length || c.neg) score -= 5;
      var options = t.kind === 'choice' ? find(h, t.options).map(function (x) { return x.term; }) : [];
      if (options.length) { score += 1; marks.push.apply(marks, options.slice(0, 2)); }
      var clsFound = t.kind === 'class' ? (scaleHits.length ? scaleHits : classes.filter(function (k) { return t.scale.some(function (x) { return x.toUpperCase() === k; }); })) : [];
      // an equivalent names the class in another scale: "MERV 14" asked = F8
      var via = '';
      if (t.kind === 'class' && !clsFound.length) t.equivalents.some(function (e) {
        var m = /^\s*(.+?)\s*=\s*([A-Za-z]+\d+(?:\.\d+)?)\b/.exec(e);
        if (!m || /\d\s*-\s*\d/.test(m[1])) return false;                       // ranges ("MERV 7-8") are for people
        var right = t.scale.filter(function (x) { return x.toUpperCase() === m[2].toUpperCase(); })[0];
        if (right && termRe(m[1]).test(h)) { clsFound = [right]; via = m[1].trim(); return true; }
        return false;
      });
      if (t.kind === 'class') score += clsFound.length ? 1.5 : (reqs.length ? -1.5 : 0);
      if (score < MIN_SCORE) return;
      var level = {};
      if (measure) { level.measure = measure; level.op = measure.op; level.value = (measure.op === 'range' ? measure.lo + ' to ' : '') + measure.m.raw; }
      if (t.kind === 'class' && clsFound.length) { level.cls = clsFound[0]; level.op = '>='; if (via) level.via = via; }
      if (std.length) level.standard = std;
      if (options.length) level.options = options;
      var asked = level.value ? (OPS[level.op || '='] || '') + level.value : level.cls ? level.cls + ' or better' + (level.via ? ' (' + level.via + ')' : '')
        : options.length ? options.join(' / ') : std.length ? std.join(', ') : t.kind === 'presence' ? 'provided' : '';
      var uniq = []; marks.forEach(function (m) { if (uniq.indexOf(m) < 0) uniq.push(m); });
      out.push({ type: t, score: Math.round(score * 10) / 10, confidence: 'low', landmarks: uniq, level: level, asked: asked });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    out.forEach(function (x, i) {
      var gap = x.score - (out[i + 1] ? out[i + 1].score : 0);
      x.confidence = x.score >= 8 && (i > 0 || gap >= 1.5) ? 'high' : x.score >= 5.5 ? 'medium' : 'low';
    });
    // one clause may ask several things ("leakage L2 and strength D2"): keep the types whose landmarks differ
    var kept = [];
    for (var i = 0; i < out.length; i++) {
      var x = out[i];
      if (kept.length >= max) break;
      if (keep && !keep(x.type, x)) continue;
      if (kept.some(function (k) { return k.type.component === x.type.component && k.landmarks.join() === x.landmarks.join(); })) continue;
      if (kept.length && x.score < kept[0].score * 0.6) break;
      kept.push(x);
    }
    return kept;
  }

  /* ---------- the rows of a specification, by the vocabulary ---------- */
  function rowRef(r) { var m = /^(.*?)\s*#(\d+)$/.exec(String(r).trim()); return m ? { key: m[1].toLowerCase(), n: +m[2] } : { key: String(r).trim().toLowerCase(), n: 0 }; }
  /* values: PRSettings values (parts, max_clauses, keep_share). Same shape as CMRows.match. */
  function match(specRows, rules, v, values) {
    var base = window.CMRows.match(specRows, rules);
    if (!v || !v.types.length) return base;
    var covered = {};
    v.types.forEach(function (t) { t.rows.forEach(function (r) { covered[rowRef(r).key] = 1; }); });
    var parts = values.parts, max = values.max_clauses, keep = values.keep_share;
    var cl = window.CMRows.clauses(specRows), hasFirst = cl.some(function (c) { return c.part === parts[0]; });
    var hits = {};          // row key -> [{ i, s, part, n, c }]
    cl.forEach(function (c, i) {
      var allowed = hasFirst ? parts.indexOf(c.part) >= 0 : true;
      if (!allowed) return;
      // a long clause asks several things ("50 mm thick ... galvanized ... hinged doors"): up to vocab_types types,
      // counting only the types that point at a datasheet row (owner, 2026-11-05: the panel thickness was lost)
      // a value type with a unit (panel thickness in mm, air flow in l/s) belongs to a clause only when the clause states a
      // figure in that unit: "provided in the panel" or "airflow switch" is not a panel thickness or an air flow
      identify(v, c.text, (c.heading + ' ' + c.sec).trim(), values.vocab_types || 6, function (t, x) {
        return t.rows.length > 0 && !(t.kind === 'value' && t.unit && !x.level.measure);
      }).forEach(function (x) {
        x.type.rows.forEach(function (r) {
          var ref = rowRef(r);
          (hits[ref.key] = hits[ref.key] || []).push({ i: i, s: x.score, part: hasFirst ? c.part : parts[0], n: ref.n, c: c, t: x.type.title, w: x.type.terms.concat(x.type.anchors) });
        });
      });
    });
    return base.map(function (row) {
      if (row.kind !== 'row' || !row.key || !covered[row.key.toLowerCase()]) return row;
      var list = hits[row.key.toLowerCase()] || [], picked = [];
      parts.some(function (p) { picked = list.filter(function (hh) { return hh.part === p; }); return picked.length > 0; });
      // one clause found twice for the row (two types point at it) counts once, with its best score
      var best = {}; picked.forEach(function (hh) { var k = hh.i + '#' + hh.n; if (!best[k] || best[k].s < hh.s) best[k] = hh; });
      picked = Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return b.s - a.s || a.i - b.i; });
      var top = picked.length ? picked[0].s : 0;
      picked = picked.filter(function (hh) { return hh.s * 100 >= top * keep; });
      var shown = picked.slice(0, max).sort(function (a, b) { return a.i - b.i; });
      // nothing found by the vocabulary for a row it covers: its Spec keywords, if the reviewers want that (vocab_fallback)
      if (!shown.length && values.vocab_fallback !== false && row.found) return Object.assign({}, row, { by: 'keywords' });
      var seenAt = {}, text = shown.filter(function (hh) { if (seenAt[hh.i]) return false; seenAt[hh.i] = 1; return true; })
        .map(function (hh) { return (hh.c.ref ? hh.c.ref + ': ' : '') + hh.c.text; }).join('\n');
      if (picked.length > max) text += '\n(+ ' + (picked.length - max) + ' more ' + (picked.length - max === 1 ? 'clause' : 'clauses') + ' by the vocabulary)';
      var lines = [], nth = {};
      shown.forEach(function (hh) {
        if (hh.n) { (nth[hh.n] = nth[hh.n] || []); if (nth[hh.n].indexOf(hh.c.row) < 0) nth[hh.n].push(hh.c.row); }
        else if (lines.indexOf(hh.c.row) < 0) lines.push(hh.c.row);
      });
      return Object.assign({}, row, { text: text, found: shown.length > 0, lines: lines, nth: Object.keys(nth).length ? nth : null, by: 'vocabulary',
                                      types: shown.map(function (hh) { return hh.t; }),
                                      // the types' words, so the Product Options picks find the figures near them (pr-picks.js near())
                                      terms: shown.reduce(function (all, hh) { return all.concat(hh.w.filter(function (x) { return all.indexOf(x) < 0; })); }, []) });
    });
  }

  /* ---------- loading ---------- */
  var cache = {};
  function load(productId) {
    if (!cache[productId]) cache[productId] = (window.Api && window.Api.prVocab ? window.Api.prVocab(productId) : Promise.reject(new Error('no vocabulary')))
      .then(function (r) { return build((r && r.items) || [], false); }, function () { return null; });
    return cache[productId];
  }

  /* ---------- checks (projects.vocab_check checks the same) ---------- */
  function checkItem(it) {
    if (!it || ['standard', 'component', 'type'].indexOf(it.level) < 0) return 'level';
    if (typeof it.title !== 'string' || !it.title.trim() || it.title.trim().length > 120) return 'a name up to 120 characters';
    if (it.level === 'type' && !String(it.component || '').trim()) return 'a component';
    if (String(it.component || '').length > 80) return 'a component name up to 80 characters';
    if (String(it.note || '').length > 2000) return 'a note up to 2000 characters';
    var f = it.fields || {};
    for (var k in f) {
      if (LISTS.concat(['kind', 'unit', 'dir', 'example']).indexOf(k) < 0) return 'unknown field ' + k;
      if (LISTS.indexOf(k) >= 0 && !(Array.isArray(f[k]) && f[k].length <= 60 && f[k].every(function (s) { return typeof s === 'string' && s.length >= 1 && s.length <= 200; })))
        return k + ': up to 60 entries of 1 to 200 characters';
    }
    if (f.unit != null && !/^[a-z0-9/%.()²³µ]{0,20}$/.test(f.unit)) return 'unit: small letters, digits and / % . ( ) only, e.g. mm, m3/h, pa';
    if (f.dir != null && ['', 'higher', 'lower', 'exact'].indexOf(f.dir) < 0) return 'direction';
    if (f.example != null && (typeof f.example !== 'string' || f.example.length > 600)) return 'an example up to 600 characters';
    if (it.level === 'type' && KINDS.indexOf(f.kind) < 0) return 'a kind: value, class, standard, choice or presence';
    if (it.level !== 'type' && f.kind != null) return 'only a type has a kind';
    return '';
  }

  /* ---------- outline (the old map's export / import) ---------- */
  var DIRS = { higher: 'higher is better', lower: 'lower is better', exact: 'must match' };
  function toOutline(items, productName) {
    var L = ['Vocabulary: ' + (productName || '')], put = function (depth, text) { L.push(new Array(depth + 1).join('  ') + text); };
    var notes = function (depth, note) { String(note || '').split('\n').filter(Boolean).forEach(function (n) { put(depth, '> ' + n); }); };
    var std = items.filter(function (x) { return x.level === 'standard'; });
    if (std.length) {
      put(1, 'Standards');
      std.forEach(function (s) { put(2, s.title); notes(3, s.note); if ((s.fields.terms || []).length) put(3, '! Terms: ' + s.fields.terms.join(', ')); });
    }
    items.filter(function (x) { return x.level === 'component'; }).forEach(function (c) {
      put(1, c.title); notes(2, c.note);
      if ((c.fields.terms || []).length) put(2, '! Terms: ' + c.fields.terms.join(', '));
      if ((c.fields.not || []).length) put(2, '! Not: ' + c.fields.not.join(', '));
      items.filter(function (t) { return t.level === 'type' && t.component.toLowerCase() === c.title.toLowerCase(); }).forEach(function (t) {
        var f = t.fields; put(2, t.title); notes(3, t.note);
        put(3, '! Kind: ' + f.kind);
        if ((f.terms || []).length) put(3, '! Terms: ' + f.terms.join(', '));
        if ((f.anchors || []).length) put(3, '! Anchors: ' + f.anchors.join(', '));
        if (f.unit) put(3, '! Unit: ' + f.unit);
        if (f.dir) put(3, '! Direction: ' + DIRS[f.dir]);
        if ((f.scale || []).length) put(3, '! Scale: ' + f.scale.join(' < '));
        if ((f.standards || []).length) put(3, '! Standard: ' + f.standards.join(', '));
        if ((f.options || []).length) put(3, '! Options: ' + f.options.join(', '));
        if ((f.not || []).length) put(3, '! Not: ' + f.not.join(', '));
        if ((f.rows || []).length) put(3, '! Row: ' + f.rows.join('; '));
        (f.equivalents || []).forEach(function (e) { put(3, '! Equivalent: ' + e); });
        if (f.example) put(3, '! Example: ' + f.example);
      });
    });
    return L.join('\n') + '\n';
  }
  var FIELD_RE = /^(kind|terms|anchors|unit|direction|scale|standard|standards|options|not|row|rows|equivalent|example|tolerance|id|note)\s*:\s*(.*)$/i;
  function list(s) { return String(s || '').split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function fromOutline(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), root = { title: '', kids: [], special: [], note: [], depth: -1 }, stack = [root], problems = [];
    lines.forEach(function (raw, no) {
      if (!raw.trim()) return;
      var ind = raw.replace(/\t/g, '    ').match(/^ */)[0].length, body = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, '');
      var depth = Math.floor(ind / 2);
      if (/^>\s?/.test(body) || /^!\s?/.test(body)) {
        var owner = stack[stack.length - 1];
        if (owner === root) { problems.push('Line ' + (no + 1) + ': a note before any branch is skipped.'); return; }
        if (body[0] === '>') owner.note.push(body.replace(/^>\s?/, '')); else owner.special.push(body.replace(/^!\s?/, ''));
        return;
      }
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      var node = { title: body.slice(0, 120), kids: [], special: [], note: [], depth: depth, line: no + 1 };
      stack[stack.length - 1].kids.push(node); stack.push(node);
    });
    var tops = root.kids;
    if (tops.length === 1 && /^vocabulary\b/i.test(tops[0].title)) tops = tops[0].kids;      // the whole map, exported with its name
    var items = [], seen = {};
    function field(n, name) { var out = []; n.special.forEach(function (s) { var m = FIELD_RE.exec(s); if (m && m[1].toLowerCase() === name) out.push(m[2].trim()); }); return out; }
    function add(it, where) {
      var k = it.level + '|' + it.component.toLowerCase() + '|' + it.title.toLowerCase();
      if (seen[k]) { problems.push(where + ': listed twice, the second is skipped.'); return; }
      var err = checkItem(it); if (err) { problems.push(where + ': ' + err + '; skipped.'); return; }
      seen[k] = 1; items.push(it);
    }
    tops.forEach(function (top) {
      var t = top.title.trim();
      if (/^how\b/i.test(t)) return;
      if (/^standards?\b/i.test(t)) {
        top.kids.forEach(function (s) { add({ level: 'standard', component: '', title: s.title.trim(), note: s.note.join('\n'), fields: { terms: list(field(s, 'terms').join(',')) } }, '"' + s.title + '"'); });
        return;
      }
      add({ level: 'component', component: t, title: t, note: top.note.join('\n'), fields: { terms: list(field(top, 'terms').join(',')), not: list(field(top, 'not').join(',')) } }, '"' + t + '"');
      (function walk(parent, path) {
        parent.kids.forEach(function (n) {
          var here = path.concat([n.title.trim()]), where = '"' + here.join(' › ') + '" (line ' + n.line + ')';
          n.special.forEach(function (s) { if (/^\s*[A-Za-z ]{2,14}:/.test(s) && !FIELD_RE.test(s.trim())) problems.push(where + ': "' + s.slice(0, 40) + '" is not a field the code reads.'); });
          var kindRaw = (field(n, 'kind')[0] || '').toLowerCase();
          if (!kindRaw) { if (n.kids.length) walk(n, here); else problems.push(where + ' has no Kind: it is not a requirement type yet; skipped.'); return; }
          var kind = KINDS.filter(function (k) { return kindRaw.indexOf(k) === 0; })[0];
          if (!kind) { problems.push(where + ': Kind "' + kindRaw + '" is not value, class, standard, choice or presence; skipped.'); return; }
          var dirRaw = (field(n, 'direction')[0] || '').toLowerCase();
          var dir = /higher|more|bigger|larger/.test(dirRaw) ? 'higher' : /lower|less|smaller/.test(dirRaw) ? 'lower' : /exact|equal|match/.test(dirRaw) ? 'exact' : '';
          add({ level: 'type', component: t, title: n.title.trim(), note: n.note.join('\n'), fields: {
            kind: kind, terms: list(field(n, 'terms').join(',')), anchors: list(field(n, 'anchors').join(',')),
            unit: (field(n, 'unit')[0] || '').toLowerCase().replace(/\s+/g, ''), dir: dir,
            scale: (field(n, 'scale')[0] || '').split(/\s*(?:<|,|;)\s*/).map(function (x) { return x.trim(); }).filter(Boolean),
            standards: list(field(n, 'standard').concat(field(n, 'standards')).join(',')), options: list(field(n, 'options').join(',')),
            not: list(field(n, 'not').join(',')), rows: list(field(n, 'row').concat(field(n, 'rows')).join(';')),
            equivalents: field(n, 'equivalent'), example: (field(n, 'example')[0] || '').slice(0, 600) } }, where);
          if (n.kids.length) walk(n, here);
        });
      })(top, [t]);
    });
    return { items: items, problems: problems };
  }

  window.PRVocab = { build: build, identify: identify, match: match, load: load, reload: function (id) { delete cache[id]; return load(id); },
                     toOutline: toOutline, fromOutline: fromOutline, checkItem: checkItem, rowRef: rowRef, MIN_SCORE: MIN_SCORE, KINDS: KINDS };
})();
