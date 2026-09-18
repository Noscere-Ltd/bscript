// Every script here is run by both src/renderer/interpreter.js and @bsv/sdk's
// Spend, and their final stacks must match. See test/differential.js.
//
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { compare, explain } = require('./differential');

const EXAMPLES = path.join(__dirname, '..', 'examples');

const CORPUS = {
  arithmetic: [
    '1 2 add', '5 9 sub', '7 6 mul', '100 7 div', '100 7 mod',
    // Truncation toward zero and the dividend's sign: the two rules most
    // easily got wrong by reaching for JavaScript's operators.
    '-100 7 div', '-100 7 mod', '7 -2 div', '7 -2 mod', '-7 -2 div', '-7 -2 mod',
    '0 1add', '-1 1add', '1 1sub', '5 negate', '-5 abs', '0 not', '3 not',
    '0 0notEqual', '7 0notEqual',
    // Values that straddle a byte boundary, where the sign byte appears.
    '127 1add', '128 1sub', '32767 1add', '-32768 1sub', '1000000 1000000 mul'
  ],

  comparison: [
    '3 3 numEqual', '3 4 numEqual', '3 4 numNotEqual', '1 2 lessThan',
    '2 1 greaterThan', '2 2 lessThanOrEqual', '2 2 greaterThanOrEqual',
    '3 7 min', '3 7 max', '5 1 10 within', '11 1 10 within',
    '1 1 booland', '1 0 booland', '0 0 boolor', '1 0 boolor',
    // equal is bytewise, so 1 and 0x0100 are different items.
    '0x0101 0x0101 equal', '0x0101 0x010100 equal', '0 0 equal', '1 1 equal',
    // Mixed representations of the same bytes. A comparison done on the
    // interpreter's JavaScript values rather than on bytes gets these wrong
    // while still agreeing on the cases above.
    '1 0x01 equal', '16 0x10 equal', '-1 0x81 equal', '1 0x01 numEqual'
  ],

  bitwise: [
    '0x0f0f 0xff00 and', '0x0f0f 0xff00 or', '0x0f0f 0xff00 xor',
    '0xff invert', '0x0000 invert',
    // Shifts must preserve the operand's width and zero-fill, not go through
    // JavaScript's 32-bit integer operators.
    '0x0101 1 lShift', '0x80 1 lShift', '0x0101 1 rShift', '0x8000 4 rShift',
    '0x0001 8 lShift', '0xff 0 lShift', '0x00ff00ff 4 lShift', '0x00ff00ff 4 rShift'
  ],

  string: [
    '0x1122 0x3344 cat', '0x11223344 2 split', '0x1122 0 split', '0x1122 2 split',
    '5 4 num2bin', '0 4 num2bin', '-5 4 num2bin',
    '0x05000000 bin2num', '0x00 bin2num',
    // size is in bytes, and counts the sign byte a number needs.
    '0xaabbcc size', '0 size', '1 size', '255 size', '127 size',
    // Single-byte literals in 1..16, and 0x81, have a shorter encoding that
    // nodes require. Compiling them the long way makes a script a node
    // rejects as non-minimal, which only comparing against a real engine
    // catches.
    '0x01 0x02 cat', '0x10 size', '0x81 bin2num', '0x0f 0x0f equal'
  ],

  stack: [
    '1 2 3 drop', '1 2 dup', '1 2 nip', '1 2 over', '1 2 3 2 pick', '1 2 3 2 roll',
    '1 2 3 rot', '1 2 swap', '1 2 tuck', '1 2 3 4 2drop', '1 2 2dup', '1 2 3 3dup',
    '1 2 3 4 2over', '1 2 3 4 5 6 2rot', '1 2 3 4 2swap', '1 2 3 depth',
    '0 ifDup', '5 ifDup', '1 toAltStack 2 fromAltStack'
  ],

  'flow control': [
    '1 if 10 endIf', '0 if 10 endIf', '0 if 10 else 20 endIf',
    '1 notIf 10 else 20 endIf',
    // Nested conditionals: a single skip flag gets these wrong.
    '1 if 1 if 11 else 12 endIf else 13 endIf',
    '1 if 0 if 11 else 12 endIf else 13 endIf',
    '0 if 1 if 11 else 12 endIf else 13 endIf',
    '0 if 0 if 11 else 12 endIf else 13 endIf',
    '1 if 1 if 1 if 1 endIf endIf endIf',
    '1 verify 9', '1 1 equalVerify 9', '3 3 numEqualVerify 9'
  ],

  hashing: [
    '0xabcd sha256', '0xabcd sha1', '0xabcd ripemd160',
    '0xabcd hash256', '0xabcd hash160', '0xaabbccddeeff hash160'
  ],

  // Both engines must reject these. The wording differs between them, so only
  // the fact of rejection is compared.
  'error paths': [
    'drop', '1 0 div', '1 0 mod', '0 verify', '1 if 2', '0x11 0x2233 and',
    '0x1122 5 split', 'endIf', '1 else 2 endIf', '1 2 5 pick', '0 0 equalVerify'
  ]
};

for (const [family, scripts] of Object.entries(CORPUS)) {
  for (const script of scripts) {
    test(`${family}: ${script}`, async () => {
      const result = await compare(script);
      assert.ok(result.agree, explain(script, result));
    });
  }
}

// The shipped examples, which exercise longer sequences than the corpus does.
// Examples using checkSig, checkMultiSig or checkPreimage are left out: the
// interpreter simulates signature checking and @bsv/sdk does real ECDSA
// against a transaction, so they cannot agree by construction. Examples using
// import are left out too, since resolving one needs window.electronAPI.
const EXAMPLE_CASES = [
  'alt-stack',
  'arithmetic',
  'bitwise',
  'conditionals',
  'stack-operations',
  'hash-puzzle'
];

for (const name of EXAMPLE_CASES) {
  test(`example ${name}.bscript matches @bsv/sdk`, async () => {
    const script = fs.readFileSync(path.join(EXAMPLES, `${name}.bscript`), 'utf8');
    const result = await compare(script);
    assert.ok(result.agree, explain(name, result));
  });
}

// Known divergence, asserted so it stays deliberate rather than becoming a
// surprise. Post-Genesis, OP_RETURN ends evaluation and @bsv/sdk returns the
// stack as it stands. The interpreter treats it as a halt the user should see,
// and reports it as an error so the debugger can show where execution stopped.
test('return is a known divergence', async () => {
  const result = await compare('1 2 return');
  assert.equal(result.agree, false, 'divergence is gone; update this test');
  assert.match(result.sim.error, /OP_RETURN/);
  assert.equal(result.ref.ok, true);
});
