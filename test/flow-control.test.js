// Flow control: nop, if, notIf, else, endIf, verify, return.

const { test } = require('node:test');
const assert = require('node:assert');
const { stack, failure } = require('./helpers');

test('nop does nothing', async () => {
  assert.deepStrictEqual(await stack('nop 5'), [5]);
});

test('if and else take one branch each', async () => {
  assert.deepStrictEqual(await stack('1 if 10 else 20 endIf'), [10]);
  assert.deepStrictEqual(await stack('0 if 10 else 20 endIf'), [20]);
  assert.deepStrictEqual(await stack('1 if 10 endIf'), [10]);
  assert.deepStrictEqual(await stack('0 if 10 endIf'), []);
});

test('notIf inverts the condition', async () => {
  assert.deepStrictEqual(await stack('0 notIf 10 else 20 endIf'), [10]);
  assert.deepStrictEqual(await stack('1 notIf 10 else 20 endIf'), [20]);
});

test('nested conditionals only run the branch they are in', async () => {
  // Regression: a single skipElse flag could not nest, so the outer else ran
  // as well and this left [20, 30] on the stack.
  assert.deepStrictEqual(await stack('1 if 0 if 10 else 20 endIf else 30 endIf'), [20]);
  assert.deepStrictEqual(await stack('1 if 1 if 10 else 20 endIf else 30 endIf'), [10]);
  assert.deepStrictEqual(await stack('0 if 1 if 10 else 20 endIf else 30 endIf'), [30]);
  assert.deepStrictEqual(await stack('0 if 0 if 10 endIf 40 else 30 endIf'), [30]);
});

test('a branch that was not taken executes nothing inside it', async () => {
  // Including opcodes that would otherwise fail on an empty stack.
  assert.deepStrictEqual(await stack('0 if dup add verify endIf 7'), [7]);
  assert.deepStrictEqual(await stack('1 if 7 else dup add verify endIf'), [7]);
});

test('the condition is read as bytes', async () => {
  assert.deepStrictEqual(await stack('if 10 else 20 endIf', ['0x00']), [20]);
  assert.deepStrictEqual(await stack('if 10 else 20 endIf', ['0x01']), [10]);
  assert.deepStrictEqual(await stack('if 10 else 20 endIf', ['0x']), [20]);
});

test('unbalanced conditionals are rejected', async () => {
  assert.match(await failure('1 if 5'), /Script ended with 1 unclosed if block\(s\)/);
  assert.match(await failure('1 if 1 if 5 endIf'), /Script ended with 1 unclosed if block\(s\)/);
  assert.match(await failure('else 1'), /Cannot execute 'else' - no matching if/);
  assert.match(await failure('1 endIf'), /Cannot execute 'endIf' - no matching if/);
});

test('verify consumes the top item and fails on a false one', async () => {
  assert.deepStrictEqual(await stack('1 verify 7'), [7]);
  assert.match(await failure('0 verify'), /Verification failed/);
  // Regression: all-zero bytes and empty bytes are false, and used to pass.
  assert.match(await failure('verify', ['0x00']), /Verification failed/);
  assert.match(await failure('verify', ['0x']), /Verification failed/);
  assert.match(await failure('verify', ['0x80']), /Verification failed/);
});

test('return terminates the script', async () => {
  assert.match(await failure('1 2 return 3'), /Script returned \(OP_RETURN\)/);
});

test('codeSeparator is a no-op for the stack', async () => {
  // It only matters for the BIP-143 scriptCode, which the SDK computes.
  assert.deepStrictEqual(await stack('1 2 codeSeparator add'), [3]);
});
