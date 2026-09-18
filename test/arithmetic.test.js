// Arithmetic: 13 opcodes. Operands may arrive as numbers or as byte strings,
// and both have to behave the same way.

const { test } = require('node:test');
const assert = require('node:assert');
const { exec, stack, failure, top } = require('./helpers');

test('add, sub and mul', async () => {
  assert.deepStrictEqual(await stack('7 5 add'), [12]);
  assert.deepStrictEqual(await stack('7 5 sub'), [2]);
  assert.deepStrictEqual(await stack('7 5 mul'), [35]);
  assert.deepStrictEqual(await stack('-7 5 add'), [-2]);
});

test('arithmetic reads byte-string operands', async () => {
  // Regression: parseInt('0x0a', 10) is 0, so these all returned 0.
  assert.deepStrictEqual(await stack('add', ['0x0a', '0x05']), [15]);
  assert.deepStrictEqual(await stack('sub', ['0x0a', '0x05']), [5]);
  assert.deepStrictEqual(await stack('mul', ['0x0a', '0x05']), [50]);
  assert.deepStrictEqual(await stack('1add', ['0x0a']), [11]);
});

test('div truncates toward zero', async () => {
  assert.deepStrictEqual(await stack('7 2 div'), [3]);
  assert.deepStrictEqual(await stack('-7 3 div'), [-2]);   // not -3
  assert.deepStrictEqual(await stack('7 -3 div'), [-2]);
});

test('mod takes the sign of the dividend', async () => {
  assert.deepStrictEqual(await stack('7 3 mod'), [1]);
  assert.deepStrictEqual(await stack('-7 3 mod'), [-1]);
  assert.deepStrictEqual(await stack('7 -3 mod'), [1]);
});

test('div and mod reject a zero divisor', async () => {
  assert.match(await failure('1 0 div'), /Division by zero/);
  assert.match(await failure('1 0 mod'), /Modulo by zero/);
});

test('negate and abs', async () => {
  assert.deepStrictEqual(await stack('5 negate'), [-5]);
  assert.deepStrictEqual(await stack('-5 negate'), [5]);
  assert.deepStrictEqual(await stack('5 abs'), [5]);
  assert.deepStrictEqual(await stack('-5 abs'), [5]);
});

test('not and 0notEqual reduce to 1 or 0', async () => {
  assert.deepStrictEqual(await stack('0 not'), [1]);
  assert.deepStrictEqual(await stack('3 not'), [0]);
  assert.deepStrictEqual(await stack('0 0notEqual'), [0]);
  assert.deepStrictEqual(await stack('5 0notEqual'), [1]);
});

test('not and 0notEqual read all-zero bytes as false', async () => {
  // 0x00 is a non-minimal zero, so it only reaches an arithmetic opcode
  // under the relaxed rules of version 2.
  assert.strictEqual(await top('not', ['0x00'], 2), 1);
  assert.strictEqual(await top('0notEqual', ['0x00'], 2), 0);
  assert.strictEqual(await top('0notEqual', ['0x01']), 1);
});

test('the div history line reports the value div pushed', async () => {
  // It used to read Math.floor, so a negative division told the user -15 while
  // the stack held -14.
  const interp = await exec('-100 7 div');
  const line = interp.executionHistory.find((entry) => entry.opcode === 'div');

  assert.strictEqual(await top('-100 7 div'), -14);
  assert.strictEqual(line.description, '-100 / 7 = -14');
});

test('version 1 rejects a non-minimally encoded number', async () => {
  assert.match(await failure('not', ['0x00']), /non-minimally encoded script number/);
  assert.match(await failure('1add', ['0x0100']), /non-minimally encoded script number/);
  // The sign byte is allowed when the byte before it needs it
  assert.strictEqual(await top('1add', ['0xff00']), 256);
});

test('1add and 1sub', async () => {
  assert.deepStrictEqual(await stack('5 1add'), [6]);
  assert.deepStrictEqual(await stack('5 1sub'), [4]);
});

test('min and max', async () => {
  assert.deepStrictEqual(await stack('2 3 min'), [2]);
  assert.deepStrictEqual(await stack('2 3 max'), [3]);
  assert.deepStrictEqual(await stack('-2 -3 min'), [-3]);
});

test('within is inclusive below and exclusive above', async () => {
  assert.deepStrictEqual(await stack('5 1 10 within'), [1]);
  assert.deepStrictEqual(await stack('1 1 10 within'), [1]);
  assert.deepStrictEqual(await stack('10 1 10 within'), [0]);
  assert.deepStrictEqual(await stack('0 1 10 within'), [0]);
});

test('numbers are not range limited (post-Genesis rules)', async () => {
  // Genesis lifted the 4-byte cap on script numbers, so nothing here should
  // fail. If a pre-Genesis mode is ever added, this is the test to revisit.
  assert.deepStrictEqual(await stack('2147483647 1add'), [2147483648]);
  assert.strictEqual(await top('5 num2bin', [2147483648]), '0x0000008000');
});
