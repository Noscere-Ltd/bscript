// Splitting a chain locking script into its code and its state.
//
// chain.js is a renderer script with no exports, so it is loaded the way the
// renderer loads it and the prototype is used directly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'renderer');
const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');

const ChainEngine = new Function(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'push-data.js'), 'utf8') +
  read('push-tx-binding.js') + read('compiler.js') + read('chain.js') +
  '\nreturn ChainEngine;'
)();

const engine = new ChainEngine();

test('the code portion ends at the OP_RETURN that carries the state', () => {
  // <OP_1> <OP_RETURN> <push 02 aabb>: code is just OP_1
  assert.strictEqual(engine.getCodePortion('516a02aabb'), '51');
});

test('an OP_RETURN inside a push is not a separator', () => {
  // The 0x6a here is data pushed by OP_PUSHDATA1, not an opcode
  const script = '514c03' + '6a6a6a' + '6a02aabb';
  assert.strictEqual(engine.getCodePortion(script), '514c036a6a6a');
});

test('the split is at the last OP_RETURN, which is where the state begins', () => {
  // A contract may carry an OP_RETURN of its own. buildLockingScript appends
  // the state after the last one, so splitting at the first loses the rest of
  // the code.
  assert.strictEqual(engine.getCodePortion('516a5152' + '6a02aabb'), '516a5152');
});

test('a script with no OP_RETURN is all code', () => {
  assert.strictEqual(engine.getCodePortion('515253'), '515253');
});

test('PUSHDATA4 data is stepped over, not read as opcodes', () => {
  // OP_PUSHDATA4 with a length of 2, then the data, then the state OP_RETURN
  const script = '4e02000000' + '6aab' + '6a0201';
  assert.strictEqual(engine.getCodePortion(script), '4e020000006aab');
  assert.strictEqual(engine.findCodeSeparator(script), undefined);
});

test('findCodeSeparator reports the last real OP_CODESEPARATOR', () => {
  assert.strictEqual(engine.findCodeSeparator('51ab52ab53'), 3);
  assert.strictEqual(engine.findCodeSeparator('5152'), undefined);
  // 0xab inside a push is data
  assert.strictEqual(engine.findCodeSeparator('01ab'), undefined);
});
