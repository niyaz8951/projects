/* Projects tile - shared by Add a specification and Compliance review (the library upload). */
/* ============================================================
   Which product a specification is about (the old worker/src/lib/product-detect.ts, in the browser). The product's own name
   counted three times in headings and the title lines, the MasterFormat section number, a little weight for parts only
   that product has. "Another product" only when it clearly dominates. */
(function () {
  "use strict";
  var KEYS = ["AHU", "FCU", "CHILLER"];
  function productKey(product) {
    var p = String(product || "").toUpperCase();
    return /AHU|AIR[\s-]*HANDL/.test(p) ? "AHU" : /FCU|FAN[\s-]*COIL/.test(p) ? "FCU" : /CHILL/.test(p) ? "CHILLER" : "";
  }
  var STRONG = {
    AHU: [{ re: /\bair[\s-]*handling[\s-]*units?\b/gi, label: "air handling unit" }, { re: /\b(?:F|D|R|P)?AHUs?\b/g, label: "AHU" }, { re: /\bair[\s-]*handlers?\b/gi, label: "air handler" }, { re: /\b23\s?7[34]\s?\d\d\b/g, label: "section 23 73 / 23 74" }],
    FCU: [{ re: /\bfan[\s-]*coil(?:[\s-]*units?)?s?\b/gi, label: "fan coil unit" }, { re: /\bFCUs?\b/g, label: "FCU" }, { re: /\b23\s?82\s?19\b/g, label: "section 23 82 19" }],
    CHILLER: [{ re: /\bchillers?\b/gi, label: "chiller" }, { re: /\b(?:water|liquid)[\s-]*chilling\b/gi, label: "water chilling package" }, { re: /\b23\s?64\s?\d\d\b/g, label: "section 23 64" }]
  };
  var WEAK = {
    AHU: /\b(EN\s?1886|EN\s?13053|casing leakage|thermal bridging|heat wheel|thermal wheel|plug fans?|mixing box(?:es)?|central[\s-]station)\b/gi,
    FCU: /\b(valve packages?|[24][\s-]pipe|room thermostats?|PICV|auxiliary drain pan|ceiling void)\b/gi,
    CHILLER: /\b(compressors?|evaporators?|condensers?|refrigerant circuits?|IPLV|NPLV|kW\/TR|crankcase heaters?)\b/gi
  };
  var HEADING = { part: 1, section: 1, heading: 1, sub: 1, title: 1 };
  var NAMES = { AHU: "air handling unit", FCU: "fan coil unit", CHILLER: "chiller" };
  function detect(lines) {
    var scores = { AHU: 0, FCU: 0, CHILLER: 0 }, hits = { AHU: {}, FCU: {}, CHILLER: {} };
    lines.slice(0, 8000).forEach(function (ln, i) {
      var text = String(ln.spec || ""); if (!text) return;
      var w = HEADING[String(ln.type || "")] || i < 40 ? 3 : 1;
      KEYS.forEach(function (k) {
        STRONG[k].forEach(function (c) { var n = (text.match(c.re) || []).length; if (n) { scores[k] += n * w; hits[k][c.label] = (hits[k][c.label] || 0) + n; } });
        scores[k] += (text.match(WEAK[k]) || []).length * 0.3;
      });
    });
    var named = {};
    KEYS.forEach(function (k) { named[k] = Object.keys(hits[k]).sort(function (a, b) { return hits[k][b] - hits[k][a]; }).map(function (l) { return "\"" + l + "\" " + hits[k][l] + "x"; }); });
    var order = KEYS.slice().sort(function (a, b) { return scores[b] - scores[a]; }), top = order[0], second = order[1];
    var clear = scores[top] >= 6 && scores[top] >= 4 * scores[second];
    return { key: clear ? top : "", scores: scores, named: named };
  }
  /* The error the page shows in the same sheet the old server's PRODUCT_MISMATCH refusal got, or null. */
  function mismatch(chosenProduct, products, lines) {
    if (!chosenProduct) return null;
    var chosen = productKey(chosenProduct.name);
    if (!chosen) return null;
    var d = detect(lines);
    if (!d.key || d.key === chosen || d.scores[chosen] * 4 > d.scores[d.key]) return null;
    var theirs = d.named[d.key].slice(0, 3).join(", "), mine = d.named[chosen].length ? d.named[chosen].slice(0, 2).join(", ") : "never";
    var other = (products || []).filter(function (x) { return productKey(x.name) === d.key; })[0] || null;
    var reason = "It reads as " + (/^[aeiou]/.test(NAMES[d.key]) ? "an" : "a") + " " + NAMES[d.key] + " specification: it names " + theirs + "; " + NAMES[chosen] + " " + (d.named[chosen].length ? "only " + mine : "is never named") + ".";
    var article = other ? (/^[aeiou]/i.test(other.name) || /^[FHLMNRSX][A-Z0-9]/.test(other.name) ? "an " : "a ") + other.name : "another product's";
    return { code: "PRODUCT_MISMATCH", message: "This looks like " + article + " specification, not " + chosenProduct.name + ". " + reason + " Saved under " + chosenProduct.name + ", its clauses would go into the " + chosenProduct.name + " library and get " + chosenProduct.name + " answers.",
             data: { chosen: { id: chosenProduct.id, name: chosenProduct.name }, detected: other, reason: reason } };
  }
  window.PRProductDetect = { detect: detect, mismatch: mismatch, productKey: productKey };
})();
