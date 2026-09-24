/*!
 * homograph-check — find out whether a domain is written in the characters you think it is.
 * Punycode decoding (RFC 3492), mixed-script detection, invisible and bidi controls.
 * Works in Node (require) and the browser (window.homographCheck). No dependencies.
 * MIT licence — https://github.com/examineip/homograph-check
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.homographCheck = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Punycode decode, RFC 3492 ----------
     Browsers and Node encode to Punycode through the URL parser but expose no
     way back, so the decoder is implemented here. Verified by round-tripping
     against what new URL() produces for the same names. */
  var P_BASE = 36, P_TMIN = 1, P_TMAX = 26, P_SKEW = 38,
      P_DAMP = 700, P_INITIAL_BIAS = 72, P_INITIAL_N = 128;

  var MAX_INT = 0x7FFFFFFF;

  function adapt(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / P_DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    var k = 0;
    while (delta > ((P_BASE - P_TMIN) * P_TMAX) >> 1) {
      delta = Math.floor(delta / (P_BASE - P_TMIN));
      k += P_BASE;
    }
    return k + Math.floor(((P_BASE - P_TMIN + 1) * delta) / (delta + P_SKEW));
  }

  /**
   * Map a basic code point to its digit value, or P_BASE if it is not a digit.
   *
   * The RFC writes these tests as "cp - 48 < 10", which relies on C's unsigned
   * wraparound to reject anything below '0'. JavaScript subtraction is signed,
   * so '!' (33) yields -15, which passes "< 10" and is accepted as a digit —
   * decoding rubbish like "xn--!!!" into a real character instead of rejecting
   * it. The ranges are therefore written out explicitly.
   */
  function digitValue(cp) {
    if (cp >= 48) { if (cp <= 57)  { return cp - 22; } }   /* 0..9  -> 26..35 */
    if (cp >= 65) { if (cp <= 90)  { return cp - 65; } }   /* A..Z  ->  0..25 */
    if (cp >= 97) { if (cp <= 122) { return cp - 97; } }   /* a..z  ->  0..25 */
    return P_BASE;
  }

  /**
   * Decode one Punycode label — the part AFTER the "xn--" prefix.
   * Returns null for any malformed input rather than throwing or guessing.
   */
  function decodeLabel(input) {
    if (typeof input !== 'string') { return null; }
    if (input === '') { return null; }          /* "xn--" with nothing after it */

    var output = [];
    var n = P_INITIAL_N, i = 0, bias = P_INITIAL_BIAS;

    var basic = input.lastIndexOf('-');
    if (basic < 0) { basic = 0; }
    for (var j = 0; j < basic; j++) {
      if (input.charCodeAt(j) >= 128) { return null; }   /* basic section must be ASCII */
      output.push(input.charCodeAt(j));
    }

    var index = basic > 0 ? basic + 1 : 0;
    while (index < input.length) {
      var oldi = i, w = 1, k = P_BASE;
      for (;;) {
        if (index >= input.length) { return null; }
        var digit = digitValue(input.charCodeAt(index));
        index++;
        if (digit >= P_BASE) { return null; }
        if (digit > Math.floor((MAX_INT - i) / w)) { return null; }   /* overflow */
        i += digit * w;
        var t = k <= bias ? P_TMIN : (k >= bias + P_TMAX ? P_TMAX : k - bias);
        if (digit < t) { break; }
        if (w > Math.floor(MAX_INT / (P_BASE - t))) { return null; }  /* overflow */
        w *= (P_BASE - t);
        k += P_BASE;
      }
      var out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      if (Math.floor(i / out) > MAX_INT - n) { return null; }          /* overflow */
      n += Math.floor(i / out);
      i %= out;
      if (n < 0 || n > 0x10FFFF) { return null; }                      /* not a code point */
      output.splice(i, 0, n);
      i++;
    }

    var s = '';
    for (var q = 0; q < output.length; q++) { s += String.fromCodePoint(output[q]); }
    return s;
  }

  /**
   * Decode a whole domain name: every "xn--" label becomes its Unicode form.
   * A label that fails to decode is left exactly as it was, so the caller can
   * still see it rather than losing the name to an exception.
   */
  function toUnicode(name) {
    if (typeof name !== 'string') { return ''; }
    return name.split('.').map(function (label) {
      if (label.toLowerCase().indexOf('xn--') !== 0) { return label; }
      var d = decodeLabel(label.slice(4));
      return d === null ? label : d;
    }).join('.');
  }

  /**
   * Encode a domain name to its ASCII (Punycode) form — the identity it
   * actually resolves through. This defers to the platform's own URL parser,
   * so the answer is what the browser or Node would really resolve, not a
   * second opinion from this library. Returns null if the name is unusable.
   */
  function toAscii(name) {
    if (typeof name !== 'string') { return null; }
    try {
      return new URL('http://' + name + '/').hostname;
    } catch (e) {
      return null;
    }
  }

  /* ---------- confusable characters ----------
     A curated set of the characters actually abused in domain names, not the
     whole Unicode confusables table, which runs to thousands of entries. An
     exotic substitution will therefore be reported as merely non-ASCII rather
     than as a lookalike \u2014 see the README. */
  var CONFUSABLE = {
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c',
    '\u0445': 'x', '\u0443': 'y', '\u0455': 's', '\u0456': 'i', '\u0458': 'j',
    '\u04BB': 'h', '\u0501': 'd', '\u051B': 'q', '\u051D': 'w', '\u043C': 'm',
    '\u0442': 't', '\u0432': 'b', '\u043A': 'k', '\u043D': 'h', '\u0491': 'r',
    '\u04CF': 'l',
    '\u03BF': 'o', '\u03B1': 'a', '\u03BD': 'v', '\u03C1': 'p', '\u03C4': 't',
    '\u03C5': 'u', '\u03C7': 'x', '\u03B5': 'e', '\u03B9': 'i', '\u03BA': 'k',
    '\u03C3': 'o', '\u03B3': 'y', '\u03C9': 'w',
    '\u0131': 'i', '\u013C': 'l', '\u1E37': 'l', '\u01A1': 'o', '\u0269': 'i',
    '\u0261': 'g',
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-',
    '\u2212': '-'
  };

  /** Characters that occupy no visual width at all. */
  var INVISIBLE = {
    '\u200B': 'zero-width space',
    '\u200C': 'zero-width non-joiner',
    '\u200D': 'zero-width joiner',
    '\uFEFF': 'zero-width no-break space',
    '\u00AD': 'soft hyphen',
    '\u2060': 'word joiner',
    '\u180E': 'Mongolian vowel separator'
  };

  /** Characters that reorder what follows them on screen. */
  var BIDI = {
    '\u202A': 'left-to-right embedding',
    '\u202B': 'right-to-left embedding',
    '\u202C': 'pop directional formatting',
    '\u202D': 'left-to-right override',
    '\u202E': 'right-to-left override',
    '\u200E': 'left-to-right mark',
    '\u200F': 'right-to-left mark',
    '\u2066': 'left-to-right isolate',
    '\u2067': 'right-to-left isolate',
    '\u2068': 'first strong isolate',
    '\u2069': 'pop directional isolate'
  };

  var SCRIPTS = [
    ['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u],
    ['Greek', /\p{Script=Greek}/u], ['Han', /\p{Script=Han}/u],
    ['Hiragana', /\p{Script=Hiragana}/u], ['Katakana', /\p{Script=Katakana}/u],
    ['Hangul', /\p{Script=Hangul}/u], ['Arabic', /\p{Script=Arabic}/u],
    ['Hebrew', /\p{Script=Hebrew}/u], ['Armenian', /\p{Script=Armenian}/u],
    ['Devanagari', /\p{Script=Devanagari}/u], ['Thai', /\p{Script=Thai}/u],
    ['Bengali', /\p{Script=Bengali}/u], ['Cherokee', /\p{Script=Cherokee}/u]
  ];

  /** Name the script a single character belongs to. */
  function scriptOf(ch) {
    for (var i = 0; i < SCRIPTS.length; i++) {
      if (SCRIPTS[i][1].test(ch)) { return SCRIPTS[i][0]; }
    }
    if (/[0-9]/.test(ch)) { return 'digit'; }
    if (ch === '-') { return 'hyphen'; }
    return 'other';
  }

  /** "U+0430" for a character. */
  function codePoint(ch) {
    var c = ch.codePointAt(0).toString(16).toUpperCase();
    while (c.length < 4) { c = '0' + c; }
    return 'U+' + c;
  }

  /**
   * Inspect a Unicode domain name character by character.
   *
   * Returns { chars, scripts, mixed, invisible, bidi, confusables, asciiGuess,
   * anyNonAscii }. `asciiGuess` is what the name is imitating, built by mapping
   * each confusable back to its Latin lookalike — it is a guess, not a lookup.
   */
  function analyse(name) {
    if (typeof name !== 'string') { name = ''; }
    var labels = name.split('.');
    var chars = [], scriptsInName = {}, mixedLabels = [];
    var invisible = [], bidi = [], confusables = [];
    var asciiGuess = '';
    var anyNonAscii = false;

    labels.forEach(function (label, li) {
      var labelScripts = {};
      Array.from(label).forEach(function (ch) {
        var code = ch.codePointAt(0);
        var s = scriptOf(ch);
        var row = { ch: ch, cp: codePoint(ch), script: s, label: li, note: '', level: '' };

        if (code > 127) { anyNonAscii = true; }

        if (INVISIBLE[ch]) {
          row.note = INVISIBLE[ch] + ' - occupies no visual space';
          row.level = 'bad';
          invisible.push(ch);
          /* contributes nothing to asciiGuess: that is the whole point of it */
        } else if (BIDI[ch]) {
          row.note = BIDI[ch] + ' - changes display order';
          row.level = 'bad';
          bidi.push(ch);
        } else if (CONFUSABLE[ch]) {
          row.note = 'looks like "' + CONFUSABLE[ch] + '"';
          row.level = 'warn';
          confusables.push(ch);
          asciiGuess += CONFUSABLE[ch];
        } else if (code > 127) {
          row.note = 'non-ASCII';
          asciiGuess += ch;
        } else {
          asciiGuess += ch;
        }

        /* digits, hyphens and punctuation belong to every script, so counting
           them would make almost any name look mixed */
        if (s !== 'digit') {
          if (s !== 'hyphen') {
            if (s !== 'other') {
              labelScripts[s] = true;
              scriptsInName[s] = true;
            }
          }
        }
        chars.push(row);
      });

      if (Object.keys(labelScripts).length > 1) {
        mixedLabels.push({ label: label, scripts: Object.keys(labelScripts) });
      }
      if (li < labels.length - 1) { asciiGuess += '.'; }
    });

    return {
      chars: chars,
      scripts: Object.keys(scriptsInName),
      mixed: mixedLabels,
      invisible: invisible,
      bidi: bidi,
      confusables: confusables,
      asciiGuess: asciiGuess,
      anyNonAscii: anyNonAscii
    };
  }

  /**
   * The whole job in one call. Accepts either form of the name.
   *
   * verdict is one of:
   *   'ascii'         plain ASCII, nothing to report
   *   'invisible'     contains characters with no visual width
   *   'bidi'          contains direction-changing controls
   *   'mixed-script'  one label written in two alphabets — near-definitive imitation
   *   'whole-script'  entirely non-Latin; ordinary for that language, but also
   *                   how the well-known apple.com demonstration worked
   *   'non-ascii'     non-ASCII with no lookalike characters found
   *
   * It reports what the characters ARE. It cannot tell you whether a domain is
   * malicious, and it performs no lookup of any kind.
   */
  function check(name) {
    if (typeof name !== 'string') { name = ''; }
    name = name.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];

    var unicode = toUnicode(name);
    var ascii = toAscii(name);
    var a = analyse(unicode);

    /* Whole-script imitation is judged on the labels that actually carry
       non-ASCII characters, NOT on the whole name. Otherwise an ASCII TLD
       makes it unreachable: "<cyrillic>.com" contributes Latin through its
       own .com and would never be reported as whole-script \u2014 which is the
       exact shape of the well-known apple.com demonstration. */
    var nonAsciiLabels = {};
    a.chars.forEach(function (row) {
      if (row.ch.codePointAt(0) > 127) { nonAsciiLabels[row.label] = true; }
    });
    var scriptsInNonAscii = {};
    a.chars.forEach(function (row) {
      if (!nonAsciiLabels[row.label]) { return; }
      if (row.script === 'digit') { return; }
      if (row.script === 'hyphen') { return; }
      if (row.script === 'other') { return; }
      scriptsInNonAscii[row.script] = true;
    });

    var verdict = 'ascii';
    if (a.invisible.length) {
      verdict = 'invisible';
    } else if (a.bidi.length) {
      verdict = 'bidi';
    } else if (a.mixed.length) {
      verdict = 'mixed-script';
    } else if (a.anyNonAscii) {
      verdict = Object.keys(scriptsInNonAscii).indexOf('Latin') === -1
        ? 'whole-script'
        : 'non-ascii';
    }

    return {
      input: name,
      unicode: unicode,
      ascii: ascii,
      punycode: ascii !== null && ascii.indexOf('xn--') !== -1,
      verdict: verdict,
      scripts: a.scripts,
      mixed: a.mixed,
      invisible: a.invisible,
      bidi: a.bidi,
      confusables: a.confusables,
      asciiGuess: a.asciiGuess,
      chars: a.chars
    };
  }

  return {
    check: check,
    analyse: analyse,
    toUnicode: toUnicode,
    toAscii: toAscii,
    decodeLabel: decodeLabel,
    scriptOf: scriptOf,
    CONFUSABLE: CONFUSABLE,
    INVISIBLE: INVISIBLE,
    BIDI: BIDI
  };
});
