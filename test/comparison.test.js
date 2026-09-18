// Comparison: 9 opcodes. equal compares bytes; the numeric comparisons
// compare decoded numbers.

const { test } = require('node:test');
const assert = require('node:assert');
const { stack, failure, top } = require('./helpers');

test('equal compares bytes, not JavaScript values', async () => {
  // Regression: === on the raw values made 0xdead differ from 0xDEAD, and
  // the number 1 differ from the byte string 0x01.
  assert.strictEqual(await top('equal', ['0xdead', '0xDEAD']), 1);
  assert.strictEqual(await top('equal', [1, '0x01']), 1);
  assert.strictEqual(await top('equal', ['0xdead', '0xbeef']), 0);
  assert.strictEqual(await top('equal', ['0x01', '0x0001']), 0); // different widths
  assert.deepStrictEqual(await stack('1 1 equal'), [1]);
  assert.deepStrictEqual(await stack('1 2 equal'), [0]);
});

test('equalVerify consumes both items and fails when they differ', async () => {
  assert.deepStrictEqual(await stack('1 1 equalVerify 7'), [7]);
  assert.match(await failure('1 2 equalVerify'), /Verification failed/);
});

test('the numeric comparisons', async () => {
  assert.deepStrictEqual(await stack('1 2 lessThan'), [1]);
  assert.deepStrictEqual(await stack('2 1 lessThan'), [0]);
  assert.deepStrictEqual(await stack('2 1 greaterThan'), [1]);
  assert.deepStrictEqual(await stack('2 2 lessThanOrEqual'), [1]);
  assert.deepStrictEqual(await stack('2 2 greaterThanOrEqual'), [1]);
  assert.deepStrictEqual(await stack('3 2 lessThanOrEqual'), [0]);
});

test('numEqual, numEqualVerify and numNotEqual', async () => {
  assert.deepStrictEqual(await stack('2 2 numEqual'), [1]);
  assert.deepStrictEqual(await stack('2 3 numEqual'), [0]);
  assert.deepStrictEqual(await stack('2 3 numNotEqual'), [1]);
  assert.deepStrictEqual(await stack('2 2 numEqualVerify 7'), [7]);
  assert.match(await failure('2 3 numEqualVerify'), /Verification failed/);
});

test('numeric comparisons decode byte-string operands', async () => {
  assert.strictEqual(await top('greaterThan', ['0x1027', '0x01']), 1); // 10000 > 1
  assert.strictEqual(await top('numEqual', ['0x1027', 10000]), 1);
  assert.strictEqual(await top('lessThan', ['0x81', '0x01']), 1);      // -1 < 1
});

test('numEqual and equal disagree on encoding, as they should', async () => {
  // 0x0001 is the number 256, so it is not numerically equal to 1, and its
  // bytes differ from 0x01 too.
  assert.strictEqual(await top('numEqual', ['0x01', '0x0001']), 0);
  assert.strictEqual(await top('equal', ['0x01', '0x0001']), 0);
  // But 0x0100 and the number 1 are the same value with different padding:
  // numEqual sees 1 == 1, equal sees different bytes.
  assert.strictEqual(await top('numEqual', ['0x0100', 1]), 1);
  assert.strictEqual(await top('equal', ['0x0100', 1]), 0);
});
