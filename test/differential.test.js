// Every script here is run by both src/renderer/interpreter.js and @bsv/sdk's
// Spend, and their final stacks must match. See test/differential.js.
//
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { compare, compareVerdict, explain } = require('./differential');

const EXAMPLES = path.join(__dirname, '..', 'examples');

const CORPUS = {
  arithmetic: [
    '1 2 add', '5 9 sub', '7 6 mul', '100 7 div', '100 7 mod',
    // Truncation toward zero and the dividend's sign: the two rules most
    // easily got wrong by reaching for JavaScript's operators.
    '-100 7 div', '-100 7 mod', '7 -2 div', '7 -2 mod', '-7 -2 div', '-7 -2 mod',
    '0 1add', '-1 1add', '1 1sub', '5 negate', '-5 abs', '0 not', '3 not',
    // Past what a double holds exactly
    '9007199254740993 1 add', '0xffffffffffffffffffffffff7f 1 add',
    '9007199254740992 1 add 1 sub', '0xffffffffffffff7f 2 mul',
    '1 60 lShiftNum', '9007199254740993 8 num2bin', '9007199254740993 8 num2bin bin2num',
    // num2bin may not let the magnitude's top bit become the sign bit
    '128 1 num2bin', '-128 1 num2bin', '255 1 num2bin',
    '128 2 num2bin', '-128 2 num2bin', '255 2 num2bin',
    '0xaa2b 4 num2bin', '0xaabb 4 num2bin', '0x0100 4 num2bin',
    // num2bin takes the operand as bytes and strips the ones it does not need
    '0x0100 1 num2bin', '0x0180 1 num2bin', '0x00000080 1 num2bin',
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
    '0x01 0x02 cat', '0x10 size', '0x81 bin2num', '0x0f 0x0f equal',
    // num2bin has no size limit after Genesis, and 0x is the empty push
    '1 521 num2bin', '0x', '0x size', '0x 0xaa cat', '0x not'
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

  // Opcodes the Genesis upgrade restored. At least three cases each,
  // including a boundary and an error.
  restored: [
    // ver pushes the 4-byte little-endian transaction version
    'ver', 'ver size', 'ver 4 num2bin equal',
    // verIf and verNotIf branch on that version, and only a 4-byte item matches
    'ver verIf 11 else 22 endIf', 'ver verNotIf 11 else 22 endIf',
    '0x01000000 verIf 11 else 22 endIf', '0x02000000 verIf 11 else 22 endIf',
    '0x01 verIf 11 else 22 endIf', 'verIf 11 endIf',
    // 2mul and 2div, with a negative operand and an empty stack
    '5 2mul', '-5 2mul', '0 2mul', '5 2div', '-5 2div', '1 2div', '2div',
    // substr, with both boundaries and two out-of-range cases
    '0x11223344 1 2 substr', '0x11223344 0 4 substr', '0x11223344 3 1 substr',
    '0x11223344 0 0 substr', '0x11223344 4 0 substr', '0x11223344 1 4 substr',
    '0x11223344 -1 2 substr', '0x1122 1 substr',
    // left and right, at both ends of their range
    '0x11223344 2 left', '0x11223344 0 left', '0x11223344 4 left',
    '0x11223344 5 left', '0x11223344 -1 left',
    '0x11223344 2 right', '0x11223344 0 right', '0x11223344 4 right',
    '0x11223344 5 right', '0x1122 right',
    // lShiftNum and rShiftNum shift the number, not the bytes
    '1 4 lShiftNum', '-1 4 lShiftNum', '5 0 lShiftNum', '1 -1 lShiftNum',
    '256 4 rShiftNum', '-256 4 rShiftNum', '7 1 rShiftNum', '5 0 rShiftNum',
    '1 -1 rShiftNum', '4 rShiftNum'
  ],

  hashing: [
    '0xabcd sha256', '0xabcd sha1', '0xabcd ripemd160',
    '0xabcd hash256', '0xabcd hash160', '0xaabbccddeeff hash160',
    // Numbers are hashed as the bytes their script encoding uses, not as text
    '5 sha256', '0 sha256', '-1 sha256', '300 hash160', '2 3 add sha256'
  ],

  // Both engines must reject these. The wording differs between them, so only
  // the fact of rejection is compared.
  'error paths': [
    'drop', '1 0 div', '1 0 mod', '0 verify', '1 if 2', '0x11 0x2233 and',
    '0x1122 5 split', 'endIf', '1 else 2 endIf', '1 2 5 pick', '1 2 3 -1 pick',
    '0 0 equalVerify', '0x123',
    // checkMultiSig counts out of range: a negative key count, a negative
    // signature count, and more signatures than keys
    '0 0 -1 checkMultiSig', '0 -1 0 checkMultiSig', '0 1 1 2 3 1 checkMultiSig'
  ]
};

// The whole corpus runs at both transaction versions: version 1 is the strict
// rule set, version 2 relaxes it, and the two engines must agree under each.
for (const txVersion of [1, 2]) {
  for (const [family, scripts] of Object.entries(CORPUS)) {
    for (const script of scripts) {
      test(`v${txVersion} ${family}: ${script}`, async () => {
        const result = await compare(script, [], txVersion);
        assert.ok(result.agree, explain(script, result));
      });
    }
  }
}

// Scripts whose verdict depends on the version: each one feeds a non-minimally
// encoded number to a numeric opcode, which only version 2 allows.
const VERSION_SENSITIVE = ['0x0100 1 add', '0x80 not', '0x0100 0x01 numEqual'];

for (const script of VERSION_SENSITIVE) {
  test(`version-sensitive: ${script}`, async () => {
    const strict = await compare(script, [], 1);
    assert.ok(strict.agree, explain(script, strict));
    assert.strictEqual(strict.sim.ok, false, `${script} should be rejected at version 1`);
    assert.match(strict.sim.error, /non-minimally encoded script number/);

    const relaxed = await compare(script, [], 2);
    assert.ok(relaxed.agree, explain(script, relaxed));
    assert.strictEqual(relaxed.sim.ok, true, `${script} should run at version 2`);
  });
}

// The shipped examples, which exercise longer sequences than the corpus does.
// Examples using checkSig, checkMultiSig or checkPreimage are left out: the
// interpreter simulates signature checking and @bsv/sdk does real ECDSA
// against a transaction, so they cannot agree by construction. Examples using
// import are left out too: compare() runs a script with no file path, so an
// import has nothing to resolve against. test/examples.test.js runs them.
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
    const result = await compare(script, name === 'hash-puzzle' ? [42] : []);
    assert.ok(result.agree, explain(name, result));
  });
}

// One else per if (D12). Spend only applies the rule when it is told Genesis
// has activated, so this case alone passes the flags. Without them Spend
// accepts the script, which is not what a node does.
for (const script of ['1 if 10 else 20 else 30 endIf', '0 if 10 else 20 else 30 endIf',
  '0 if 1 if 2 else 3 else 4 endIf endIf']) {
  test(`a second else is rejected, as @bsv/sdk does with the Genesis flags: ${script}`, async () => {
    const result = await compare(script, [], 1, ['GENESIS', 'UTXO_AFTER_GENESIS']);
    assert.ok(result.agree, explain(script, result));
    assert.strictEqual(result.ref.ok, false);
    assert.match(result.ref.error, /OP_ELSE may only be used once/);
    assert.match(result.sim.error, /OP_ELSE may only be used once/);
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

// The final verdict, which the harness above skips: Spend.validate() adds the
// clean-stack and truthiness rules, and interpreter.run() applies its own copy
// of them. Only the accept or reject answer is compared, not the wording.
const VERDICTS = [
  { script: '1', v1: true, v2: true },
  { script: '5 4 sub', v1: true, v2: true },
  { script: '0', v1: false, v2: false },
  { script: '1 1 sub', v1: false, v2: false },
  { script: '1 drop', v1: false, v2: false },
  { script: '1 2', v1: false, v2: true },
  { script: '1 2 3', v1: false, v2: true },
  { script: '1 0', v1: false, v2: false },
  { script: '0x00', v1: false, v2: false },
  { script: '0x0080', v1: false, v2: false }
];

for (const { script, v1, v2 } of VERDICTS) {
  for (const [txVersion, expected] of [[1, v1], [2, v2]]) {
    test(`verdict v${txVersion}: ${script}`, async () => {
      const result = await compareVerdict(script, [], txVersion);
      assert.ok(result.agree,
        `${script} at version ${txVersion}\n  interpreter: ${result.sim.error || 'valid'}` +
        `\n  @bsv/sdk:    ${result.ref.error || 'valid'}`);
      assert.strictEqual(result.sim.ok, expected);
    });
  }
}
