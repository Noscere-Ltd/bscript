// Finding OP_CODESEPARATOR as an opcode, not as a byte.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lastCodeSeparatorIndex } = require('../src/shared/script-walk');
const { ScriptInterpreter, compileInstructionsToHex } = require('./helpers');

const bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));

test('p2pkh-checksig has ab in its pubkey hash and no code separator', async () => {
  // F45: the Settings preimage tool scanned every byte for ab and cut the
  // scriptCode in the middle of this script's pubkey hash
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'examples', 'p2pkh-checksig.bscript'), 'utf8');
  const hex = compileInstructionsToHex(await new ScriptInterpreter().parse(source, []));

  assert.match(hex, /^(..)*ab/, 'the example should still carry an ab byte for this test to mean anything');
  assert.strictEqual(lastCodeSeparatorIndex(bytes(hex)), undefined);
});

test('the last real OP_CODESEPARATOR is reported by byte offset', () => {
  assert.strictEqual(lastCodeSeparatorIndex(bytes('51ab52ab53')), 3);
  assert.strictEqual(lastCodeSeparatorIndex(bytes('02abab51')), undefined);
  assert.strictEqual(lastCodeSeparatorIndex(bytes('')), undefined);
});

test('the Settings preimage tool and the chain engine both use the opcode walk', () => {
  // ponytail: source-level check, the call site needs the DOM
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');
  const tool = read('app.js').match(/async function computePreimage\(\)[\s\S]*?\n}/)[0];
  assert.match(tool, /lastCodeSeparatorIndex\(/);
  assert.doesNotMatch(tool, /=== 'ab'/);
  assert.match(read('chain.js'), /lastCodeSeparatorIndex\(/);
});
