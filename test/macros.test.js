// Macro expansion: everything expandMacros rewrites before tokenisation.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter, PREIMAGE, stack, top, failure } = require('./helpers');

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
  assert.strictEqual(await top('hashCat', ['0xdead']), hashed + 'dead');
});

test('checkPreimage is not expanded: it compiles to the binding', () => {
  // It used to expand to `codeSeparator <G> checkSigVerify`, which checked a
  // signature the spender supplied and never tied it to the preimage.
  assert.strictEqual(expand('checkPreimage'), 'checkPreimage');
});

test('checkPreimage leaves the preimage behind for the extractors', async () => {
  // The binding consumes nothing: it derives its own signature from the
  // preimage and puts the preimage back. Net stack effect zero.
  assert.deepStrictEqual(await stack('checkPreimage', [PREIMAGE]), [PREIMAGE]);
});

test('checkPreimage without a preimage on the stack fails', async () => {
  assert.match(await failure('checkPreimage'), /requires the preimage/);
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

test('a macro name is only expanded as a whole word', async () => {
  // A name that merely contains a macro name is a different token, and
  // rewriting part of it produced a script the author never wrote.
  assert.strictEqual(expand('myhashCat'), 'myhashCat');
  assert.strictEqual(expand('hashCatalogue'), 'hashCatalogue');
  assert.strictEqual(expand('prefixxRot_3'), 'prefixxRot_3');
  assert.strictEqual(expand('xDrop_2suffix'), 'xDrop_2suffix');
  // And the real thing still expands
  assert.strictEqual(expand('hashCat'), 'dup sha256 swap cat');
  assert.strictEqual(expand('xRot_3'), '3 roll');
});

test('a macro named in a comment is not expanded into the script', async () => {
  // Comments are stripped before expansion, so mentioning a macro while
  // explaining the code cannot put its body in the token stream.
  const interp = new ScriptInterpreter();
  await interp.parse('// hashCat would go here\n1 2 add', []);

  assert.deepStrictEqual(interp.instructions, ['1', '2', 'add']);
});

test('a named import mentioned in a comment is not expanded either', () => {
  // parse() strips comments before it calls expandMacros, so the expansion
  // never sees the mention. Checked here on the text parse() hands over.
  const interp = new ScriptInterpreter();
  interp.namedImports = { double: '2 mul' };

  assert.strictEqual(interp.expandMacros('5 double').trim(), '5 2 mul');
  assert.strictEqual(interp.expandMacros('5 add').trim(), '5 add');
});
