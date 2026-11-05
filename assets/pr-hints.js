/* ============================================================
   Projects - hints under a clause (owner, 2026-11-05: "proceed with next steps and complete the implementation", after the
   simulation on a real specification). The compliance is answered as the manufacturer (AHU, FCU or chiller maker) for the
   contractor / consultant; two answers a reviewer otherwise works out clause by clause are hinted, never filled:

     In Contractor's Scope?  the clause is the contractor's work: a Part listed in scope_parts (Execution), a section whose
                             title has a scope_sections word, or a scope_words phrase anywhere ("by the contractor",
                             "concrete bases"); the Part and section hints are held back where the clause or its section
                             names the manufacturer's own work (scope_manufacturer: field service, start-up, training).
     Not Applicable?         the clause asks for something the project's datasheet does not have (absent_rules: words in
                             the clause or the heading above it; the datasheet shows one of "has" and none of "lacks").
                             Only with a datasheet of the product in the project.

   No AI: word lists edited on Matching rules > Hints (pr-settings.js holds the built-in ones). A hint whose answer the
   clause already has is not shown. On the record a tap in Edit puts the answer in the Compliance box (and saves it, as if
   typed); in Read and in the Excel files hints do not appear.

   PRHints.build({ lines, values, product, sheet }) -> { by_index: { i: [hint] }, count }
     lines    the record's lines (type, sr, spec, can); values  PRSettings values; product  the record's product id
     sheet    the datasheet text of the product in the project (PRMatch.load's sheetText), '' when there is none
   hint: { kind: 'scope' | 'absent', answer, reason }
   PRHints.one(text, { part, section, heading, product, sheet, values }) -> [hint]   (Try a clause)
   ============================================================ */
(function () {
  'use strict';
  function norm(s) { return ' ' + String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }
  var cache = {};
  function re(list) {
    var key = JSON.stringify(list || []);
    if (!(key in cache)) cache[key] = list && list.length ? window.PRSettings.topicRegex(list) : null;
    return cache[key];
  }
  function hit(list, text) { var r = re(list); if (!r) return ''; var m = r.exec(text); return m ? m[1] : ''; }

  function one(text, o) {
    var v = o.values, out = [], t = norm(text), s = norm(o.section || ''), h = norm(o.heading || '');
    if (v.hint_scope !== false) {
      // the heading above counts too: "2. Support location, type and weight" under "B. Coordination Drawings:"
      var own = hit(v.scope_words, t), above = own ? '' : hit(v.scope_words, h), mine = hit(v.scope_manufacturer, t + ' ' + s + ' ' + h);
      var reason = own ? 'it names "' + own + '"' : above ? 'the heading above names "' + above + '"'
        : mine ? ''
        : (v.scope_parts || []).indexOf(o.part) >= 0 ? 'Part ' + o.part + (o.part === 3 ? ' (Execution)' : '') + ' is the contractor’s work'
        : hit(v.scope_sections, s) ? 'section "' + String(o.section || '').trim() + '"' : '';
      if (reason) out.push({ kind: 'scope', answer: "In Contractor's Scope", reason: reason });
    }
    if (v.hint_absent !== false && o.sheet) {
      var sheet = ' ' + o.sheet + ' ', both = t + ' ' + h;
      (v.absent_rules || []).some(function (r) {
        if (r.products && r.products.length && r.products.indexOf(o.product) < 0) return false;
        var w = hit(r.clause, both); if (!w) return false;
        if (r.has && r.has.length && !hit(r.has, sheet)) return false;
        if (r.lacks && r.lacks.length && hit(r.lacks, sheet)) return false;
        out.push({ kind: 'absent', answer: 'Not Applicable', reason: r.label + ' (the clause names "' + w + '")' });
        return true;                                       // one reason is enough
      });
    }
    return out;
  }

  // the heading a clause sits under ("T. Humidifier-Evaporative Sections" above "1. The water tank shall ..."): its label
  function headingOf(lines, i) {
    var p = window.PRPicks && window.PRPicks.parentOf ? window.PRPicks.parentOf(lines, i) : '';
    return p && window.PRPicks.subjectOf ? window.PRPicks.subjectOf(p) : '';
  }

  function build(o) {
    var lines = o.lines || [], v = o.values, out = {}, count = 0, part = 0, section = '';
    var rows = lines.map(function (l) { return { type: l.type, sr: l.sr, spec: l.spec || '' }; });
    lines.forEach(function (l, i) {
      if (l.type === 'part') { var m = /PART\s+([0-9IVX]+)/i.exec(l.spec || ''); if (m) part = { I: 1, II: 2, III: 3 }[m[1].toUpperCase()] || parseInt(m[1], 10) || part; section = ''; return; }
      if (l.type === 'section') { section = l.spec || ''; return; }
      if (!l.can) return;
      var hints = one(l.spec, { part: part, section: section, heading: headingOf(rows, i), product: o.product, sheet: o.sheet || '', values: v });
      if (hints.length) { out[i] = hints; count++; }
    });
    return { by_index: out, count: count };
  }

  window.PRHints = { build: build, one: one, norm: norm };
})();
