// Macro expansion: everything expandMacros rewrites before tokenisation.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter, PREIMAGE, stack, top } = require('./helpers');

const expand = (src) => new ScriptInterpreter().expandMacros(src).trim();

test('LOOP repeats its body and substitutes the index', async () => {
  assert.strictEqual(expand('LOOP[3]{$i 1add}'), '0 1add 1 1add 2 1add');
  assert.deepStrictEqual(await stack('LOOP[3]{1}'), [1, 1, 1]);
});

test('xSwap_n brings the nth item to the top and puts the old top back', async () => {
  assert.strictEqual(expand('xSwap_1'), 'swap');
  assert.strictEqual(expand('xSwap_3'), '3 roll swap 2 roll');
  assert.deepStrictEqual(await stack('1 2 xSwap_1'), [2, 1]);
});

test('xDrop_n drops the nth item', async () => {
  assert.strictEqual(expand('xDrop_0'), 'drop');
  assert.strictEqual(expand('xDrop_2'), '2 roll drop');
  assert.deepStrictEqual(await stack('1 2 3 xDrop_2'), [2, 3]);
});

test('xRot_n rotates the nth item to the top', async () => {
  assert.strictEqual(expand('xRot_1'), '');
  assert.strictEqual(expand('xRot_3'), '3 roll');
  assert.deepStrictEqual(await stack('1 2 3 4 xRot_3'), [2, 3, 4, 1]);
});

test('hashCat hashes a copy and concatenates it', async () => {
  assert.strictEqual(expand('hashCat'), 'dup sha256 swap cat');
  const hashed = await top('sha256', ['0xdead']);
  assert.strictEqual(await top('hashCat', ['0xdead']), '0x' + hashed + 'dead');
});

test('checkPreimage expands to the OP_PUSH_TX sequence', () => {
  assert.strictEqual(
    expand('checkPreimage'),
    'codeSeparator 0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 checkSigVerify'
  );
});

test('checkPreimage leaves the preimage behind for the extractors', async () => {
  // Regression: the signature has to sit above the preimage, or checkSigVerify
  // consumes the preimage instead of the signature.
  assert.deepStrictEqual(await stack('checkPreimage', [PREIMAGE, '0xsig'.replace('sig', 'a1')]),
    [PREIMAGE]);
});

test('the fixed-offset extractors read from the start of the preimage', async () => {
  assert.strictEqual(await top('extractVersion', [PREIMAGE]), 2);
  assert.strictEqual(await top('extractHashPrevouts', [PREIMAGE]), '0x' + '00'.repeat(32));
  assert.strictEqual(await top('extractHashSequence', [PREIMAGE]), '0x' + '11'.repeat(32));
  assert.strictEqual(await top('extractOutpoint', [PREIMAGE]), '0x' + 'aa'.repeat(32) + '01000000');
  assert.strictEqual(await top('extractInputIndex', [PREIMAGE]), 1);
});

test('the end-relative extractors survive a variable-length scriptCode', async () => {
  // Same fields, but with a 5-byte scriptCode instead of 25.
  const shorter = PREIMAGE.replace('76a914' + 'bb'.repeat(20) + '88ac', '76a9145151');

  for (const preimage of [PREIMAGE, shorter]) {
    assert.strictEqual(await top('extractAmount', [preimage]), 10000);
    assert.strictEqual(await top('extractLocktime', [preimage]), 1000);
    assert.strictEqual(await top('extractSigHashType', [preimage]), 65);
    assert.strictEqual(await top('extractOutputHash', [preimage]), '0x' + 'cc'.repeat(32));
  }
});

test('extractors consume the preimage, so scripts dup before each one', async () => {
  assert.deepStrictEqual(await stack('dup extractVersion drop dup extractLocktime drop size', [PREIMAGE]),
    [PREIMAGE, 181]);
});
