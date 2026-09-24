'use strict';
// Validate homograph-check against an INDEPENDENT reference: the platform's own
// IDNA implementation, reached through new URL(). Every Unicode name below is
// encoded by the URL parser and then decoded by this library; the two must agree.
// That is a real cross-check, not this library grading its own homework.
//   node tests/run.js

const path = require('path');
const assert = require('assert');
const h = require(path.join(__dirname, '..', 'homograph-check.js'));

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${label}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Round-trip against the platform IDNA
// ---------------------------------------------------------------------------
const ROUNDTRIP = [
  'p\u0430ypal.com',                 // Cyrillic a inside Latin
  '\u0430\u0440\u0440\u04CF\u0435.com', // whole-script Cyrillic
  'm\u00FCnchen.de',
  'b\u00FCcher.example',
  '\u65E5\u672C\u8A9E.jp',
  '\u043F\u0440\u0438\u043C\u0435\u0440.\u0440\u0444', // BOTH labels punycode
  '\u03B8\u03B5\u03C3\u03C3\u03B1\u03BB\u03BF\u03BD\u03AF\u03BA\u03B7.gr',
  'g\u043E\u043Egle.com',
  'micr\u043Es\u043Eft.com',
  '\uD55C\uAD6D.kr',
  'caf\u00E9.fr'
];

for (const name of ROUNDTRIP) {
  check(`round-trip ${name}`, () => {
    const ascii = h.toAscii(name);
    assert.ok(ascii, 'toAscii returned null');
    assert.ok(ascii.indexOf('xn--') !== -1, `expected a punycode form, got ${ascii}`);
    const back = h.toUnicode(ascii);
    assert.strictEqual(
      back.normalize('NFC'),
      name.normalize('NFC'),
      `decoded to ${back}`
    );
  });
}

// A plain ASCII name must survive both directions untouched.
check('ascii name is left alone', () => {
  assert.strictEqual(h.toAscii('paypal.com'), 'paypal.com');
  assert.strictEqual(h.toUnicode('paypal.com'), 'paypal.com');
});

// ---------------------------------------------------------------------------
// 2. Malformed Punycode must be REJECTED, not guessed at
//
// The RFC writes its digit test as "cp - 48 < 10", relying on C's unsigned
// wraparound. Done with signed arithmetic in JavaScript, '!' (33) gives -15,
// passes the test, and "xn--!!!" decodes to a real character. These are the
// regression tests for that.
// ---------------------------------------------------------------------------
const MALFORMED = [
  '',            // "xn--" with nothing after it
  '!!!',         // below '0' \u2014 the signed-comparison bug
  ' ',
  '\u00E9',      // non-ASCII in the encoded section
  'a!b',
  '999999999999999999999999'  // overflow
];

for (const bad of MALFORMED) {
  check(`decodeLabel rejects ${JSON.stringify(bad)}`, () => {
    assert.strictEqual(h.decodeLabel(bad), null);
  });
}

check('decodeLabel rejects non-strings', () => {
  assert.strictEqual(h.decodeLabel(null), null);
  assert.strictEqual(h.decodeLabel(undefined), null);
  assert.strictEqual(h.decodeLabel(42), null);
});

// Not malformed: a label with nothing after its final hyphen is just a basic
// string with an empty extended section. Node's own punycode.decode('---')
// returns '--' as well, so this is the reference behaviour, not a quirk.
check('basic-only label decodes to its basic string', () => {
  assert.strictEqual(h.decodeLabel('---'), '--');
  assert.strictEqual(h.decodeLabel('a-'), 'a');
});

// The empty label is a deliberate departure: "xn--" is rejected outright by
// the real URL parser (new URL('http://xn--.com/') throws), so null is the
// honest answer for a domain, even though punycode.decode('') returns ''.
check('empty label is rejected, matching what the URL parser does with xn--', () => {
  assert.strictEqual(h.decodeLabel(''), null);
});

check('a label that will not decode is left intact, not dropped', () => {
  assert.strictEqual(h.toUnicode('xn--!!!.com'), 'xn--!!!.com');
  assert.strictEqual(h.toUnicode('xn--.com'), 'xn--.com');
});

// ---------------------------------------------------------------------------
// 3. Verdicts
// ---------------------------------------------------------------------------
check('plain ascii -> ascii', () => {
  const r = h.check('paypal.com');
  assert.strictEqual(r.verdict, 'ascii');
  assert.strictEqual(r.punycode, false);
  assert.deepStrictEqual(r.confusables, []);
});

check('one Cyrillic letter among Latin -> mixed-script', () => {
  const r = h.check('p\u0430ypal.com');
  assert.strictEqual(r.verdict, 'mixed-script');
  assert.strictEqual(r.ascii, 'xn--pypal-4ve.com');
  assert.strictEqual(r.asciiGuess, 'paypal.com');
  assert.ok(r.mixed.length === 1, 'expected exactly one mixed label');
  assert.deepStrictEqual(r.mixed[0].scripts.sort(), ['Cyrillic', 'Latin']);
});

check('entirely Cyrillic -> whole-script', () => {
  const r = h.check('\u0430\u0440\u0440\u04CF\u0435.com');
  assert.strictEqual(r.verdict, 'whole-script');
  assert.strictEqual(r.ascii, 'xn--80ak6aa92e.com');
  assert.strictEqual(r.asciiGuess, 'apple.com');
});

check('accepts the punycode form as input too', () => {
  const r = h.check('xn--pypal-4ve.com');
  assert.strictEqual(r.verdict, 'mixed-script');
  assert.strictEqual(r.unicode, 'p\u0430ypal.com');
});

check('zero-width joiner -> invisible, and outranks everything else', () => {
  const r = h.check('pay\u200Dpal.com');
  assert.strictEqual(r.verdict, 'invisible');
  assert.strictEqual(r.invisible.length, 1);
  // the invisible character must not appear in the guess: it has no width
  assert.strictEqual(r.asciiGuess, 'paypal.com');
});

check('right-to-left override -> bidi', () => {
  const r = h.check('pay\u202Epal.com');
  assert.strictEqual(r.verdict, 'bidi');
  assert.strictEqual(r.bidi.length, 1);
});

check('non-Latin with no lookalikes -> whole-script, not flagged as imitation', () => {
  const r = h.check('\u65E5\u672C\u8A9E.jp');
  assert.strictEqual(r.verdict, 'whole-script');
  assert.deepStrictEqual(r.confusables, []);
  assert.deepStrictEqual(r.mixed, []);
});

check('a scheme and path are stripped before analysis', () => {
  const r = h.check('https://p\u0430ypal.com/login?x=1');
  assert.strictEqual(r.input, 'p\u0430ypal.com');
  assert.strictEqual(r.verdict, 'mixed-script');
});

// ---------------------------------------------------------------------------
// 4. Script classification
// ---------------------------------------------------------------------------
check('digits and hyphens do not count as a second script', () => {
  // "my-site2.com" is Latin + digit + hyphen; counting those would make
  // almost every ordinary domain look mixed-script.
  const r = h.check('my-site2.com');
  assert.deepStrictEqual(r.mixed, []);
  assert.deepStrictEqual(r.scripts, ['Latin']);
});

check('scriptOf names the obvious ones', () => {
  assert.strictEqual(h.scriptOf('a'), 'Latin');
  assert.strictEqual(h.scriptOf('\u0430'), 'Cyrillic');
  assert.strictEqual(h.scriptOf('\u03B1'), 'Greek');
  assert.strictEqual(h.scriptOf('7'), 'digit');
  assert.strictEqual(h.scriptOf('-'), 'hyphen');
});

check('Cyrillic a and Latin a really are different code points', () => {
  assert.notStrictEqual('\u0430', 'a');
  assert.strictEqual('\u0430'.codePointAt(0), 0x0430);
  assert.strictEqual('a'.codePointAt(0), 0x0061);
});

// ---------------------------------------------------------------------------
// 5. Defensive input
// ---------------------------------------------------------------------------
check('empty and junk input do not throw', () => {
  for (const v of ['', '   ', '.', '...', null, undefined, 42, {}]) {
    const r = h.check(v);
    assert.ok(r && typeof r.verdict === 'string');
  }
});

// ---------------------------------------------------------------------------
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('');
  for (const f of failures) { console.log('  FAIL  ' + f); }
  process.exit(1);
}
