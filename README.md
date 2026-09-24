# homograph-check

Find out whether a domain is written in the characters you think it is.

A Cyrillic `а` (U+0430) and a Latin `a` (U+0061) are different characters that render
identically in effectively every UI font. A domain built from one is a completely different
domain to the one your eye reads — and the only reliable tell is Punycode, the ASCII form
every non-ASCII name resolves through.

Browsers and Node will *encode* to Punycode for you through the URL parser. Neither gives you
a way back. This library does the decode, then tells you what the characters actually are.

One file, no dependencies, works in Node and the browser.

```js
const h = require('homograph-check');

h.check('pаypal.com');
// {
//   unicode:    'pаypal.com',
//   ascii:      'xn--pypal-4ve.com',   <- what it really resolves to
//   verdict:    'mixed-script',
//   asciiGuess: 'paypal.com',          <- what it is imitating
//   mixed:      [ { label: 'pаypal', scripts: [ 'Latin', 'Cyrillic' ] } ],
//   ...
// }
```

It accepts either form, so you can paste the Punycode straight from a URL bar:

```js
h.check('xn--pypal-4ve.com').unicode;   // 'pаypal.com'
h.toUnicode('xn--80ak6aa92e.com');      // 'аррӏе.com'
h.toAscii('münchen.de');                // 'xn--mnchen-3ya.de'
```

## Verdicts

| verdict | meaning |
|---|---|
| `ascii` | Plain ASCII. Nothing to report. |
| `mixed-script` | One label written in two alphabets. The strongest signal — no language is written that way, so it is close to definitive evidence of deliberate imitation. |
| `whole-script` | Entirely non-Latin. Perfectly ordinary for a Russian or Greek site — but also how the well-known `аррӏе.com` demonstration worked, and because it is not mixed-script it defeated the browser protections of the time. Judge it on context. |
| `invisible` | Contains characters with no visual width at all: zero-width joiners, zero-width spaces, soft hyphens. The name looks exactly like the name without them and resolves somewhere else. |
| `bidi` | Contains direction-changing controls. Right-to-left override is the mechanism behind the classic filename trick where `exe.doc` is displayed and `cod.exe` executes. |
| `non-ascii` | Non-ASCII, but no lookalike characters found. |

`invisible` and `bidi` outrank the script verdicts, because a name can be both.

## What it will not tell you

**Whether the domain is malicious.** It reports what the characters *are*. A plain ASCII domain
can be a phishing site, and a Cyrillic domain is very often entirely legitimate.

**Whether it is registered.** No lookup of any kind is performed — no DNS, no WHOIS, no network
access at all. It reads the string you passed it and nothing else.

**Every possible confusable.** Unicode's confusables table runs to thousands of entries. This
uses a curated set of the characters actually abused in domain names, so an exotic substitution
is reported as merely `non-ascii` rather than as a lookalike.

**How your browser will display it.** Browsers apply their own IDN display rules, and they
differ from each other and change between versions.

## API

| call | returns |
|---|---|
| `check(name)` | The whole job: verdict, both forms, scripts, findings, per-character detail. Strips a scheme and path if you pass a URL. |
| `toUnicode(name)` | Every `xn--` label decoded. A label that will not decode is left intact rather than lost. |
| `toAscii(name)` | The ASCII form, via the platform's own URL parser — so it is what the browser or Node would really resolve, not a second opinion. `null` if the name is unusable. |
| `decodeLabel(s)` | One Punycode label, the part *after* `xn--`. `null` for anything malformed. |
| `analyse(name)` | Per-character breakdown without the verdict logic. |
| `scriptOf(ch)` | The script a single character belongs to. |

## Two things worth knowing about the implementation

**RFC 3492 is written for unsigned arithmetic.** The reference decoder tests digits with
`cp - 48 < 10`, relying on C's unsigned wraparound to reject anything below `'0'`. In
JavaScript that subtraction is signed, so `'!'` (33) gives −15, passes the test, and
`xn--!!!` decodes into a real character instead of being rejected. The ranges here are written
out explicitly, and there is a regression test for it.

**Whole-script imitation is judged per label, not per name.** `аррӏе.com` has a Latin `.com`,
so a naive check over the whole name always finds Latin present and never reports whole-script
— which is exactly the case that matters. Only labels that actually carry non-ASCII characters
are considered.

## Tests

```
node tests/run.js
```

The decoder is validated against an **independent reference**: the platform's own IDNA
implementation, reached through `new URL()`. Each Unicode name is encoded by the URL parser and
decoded by this library, and the two must agree — rather than the library grading its own
homework. The rest covers malformed-input rejection, the verdict logic and script
classification.

Non-ASCII characters in the source are written as `\uXXXX` escapes rather than literals. In a
library about characters that look identical, a reviewer has to be able to see which code point
is meant without trusting their font.

## Live version

Runs entirely in your browser, no lookup performed, nothing sent anywhere:
**https://tools.examineip.com/homograph-checker/**

## Licence

MIT
