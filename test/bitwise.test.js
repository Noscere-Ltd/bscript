// Bitwise: 6 opcodes, all of which work on bytes rather than on 32-bit
// JavaScript integers.

const { test } = require('node:test');
const assert = require('node:assert');
const { stack, failure, top } = require('./helpers');

test('and, or and xor combine bytes', async () => {
  // Regression: these used JS integer operators on toNumber's output, which
  // read a byte string as 0.
  assert.strictEqual(await top('and', ['0xff00', '0x0f0f']), '0x0f00');
  assert.strictEqual(await top('or', ['0xff00', '0x0f0f']), '0xff0f');
  assert.strictEqual(await top('xor', ['0xff00', '0x0f0f']), '0xf00f');
});

test('and, or and xor need operands of the same width', async () => {
  assert.match(await failure('and', ['0xff', '0x0f0f']), /operands must be the same size \(1 vs 2 bytes\)/);
  assert.match(await failure('or', ['0xff', '0x0f0f']), /operands must be the same size/);
  assert.match(await failure('xor', ['0xff', '0x0f0f']), /operands must be the same size/);
});

test('number operands are encoded before being combined', async () => {
  assert.deepStrictEqual(await stack('12 10 and'), ['0x08']);
  assert.deepStrictEqual(await stack('12 10 or'), ['0x0e']);
  assert.deepStrictEqual(await stack('12 10 xor'), ['0x06']);
});

test('invert complements every byte', async () => {
  assert.strictEqual(await top('invert', ['0xff']), '0x00');
  assert.strictEqual(await top('invert', ['0x05']), '0xfa');
  assert.strictEqual(await top('invert', ['0x0f0f']), '0xf0f0');
});

test('lShift and rShift shift the whole byte string', async () => {
  assert.strictEqual(await top('lShift', ['0x01', 4]), '0x10');
  assert.strictEqual(await top('rShift', ['0x10', 4]), '0x01');
  assert.strictEqual(await top('lShift', ['0x0001', 8]), '0x0100');
  assert.strictEqual(await top('rShift', ['0x0100', 8]), '0x0001');
});

test('shifting keeps the operand width and discards what falls off', async () => {
  assert.strictEqual(await top('lShift', ['0xff00', 8]), '0x0000');
  assert.strictEqual(await top('rShift', ['0x00ff', 8]), '0x0000');
  assert.strictEqual(await top('lShift', ['0x8001', 1]), '0x0002');
  assert.strictEqual(await top('lShift', ['0xdead', 0]), '0xdead');
});

test('shifting by a negative number of bits is rejected', async () => {
  assert.match(await failure('lShift', ['0x01', -1]), /Cannot shift by a negative number of bits/);
  assert.match(await failure('rShift', ['0x01', -1]), /Cannot shift by a negative number of bits/);
});
