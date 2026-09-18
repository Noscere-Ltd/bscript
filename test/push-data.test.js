// The push encoding shared by the compiler and the main process.

const { test } = require('node:test');
const assert = require('node:assert');
const { emitPushData, pushDataHex } = require('../src/shared/push-data');

const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('the short forms are the minimal ones a node accepts', () => {
  assert.deepStrictEqual(emitPushData([]), [0x00]);
  assert.deepStrictEqual(emitPushData([1]), [0x51]);
  assert.deepStrictEqual(emitPushData([16]), [0x60]);
  assert.deepStrictEqual(emitPushData([0x81]), [0x4f]);
  assert.deepStrictEqual(emitPushData([17]), [0x01, 17]);
  assert.deepStrictEqual(emitPushData([0]), [0x01, 0x00]);
});

test('each length picks the smallest opcode that can carry it', () => {
  assert.strictEqual(hex(emitPushData(new Array(75).fill(0xaa))).slice(0, 2), '4b');
  assert.strictEqual(hex(emitPushData(new Array(76).fill(0xaa))).slice(0, 4), '4c4c');
  assert.strictEqual(hex(emitPushData(new Array(255).fill(0xaa))).slice(0, 4), '4cff');
  assert.strictEqual(hex(emitPushData(new Array(256).fill(0xaa))).slice(0, 6), '4d0001');
  assert.strictEqual(hex(emitPushData(new Array(65535).fill(0xaa))).slice(0, 6), '4dffff');
});

test('an item over 65535 bytes uses PUSHDATA4 instead of failing', () => {
  const big = emitPushData(new Array(65536).fill(0xaa));
  assert.strictEqual(hex(big).slice(0, 10), '4e00000100');
  assert.strictEqual(big.length, 65536 + 5);
});

test('pushDataHex is the same encoding, taken and given as hex', () => {
  assert.strictEqual(pushDataHex(''), '00');
  assert.strictEqual(pushDataHex('01'), '51');
  assert.strictEqual(pushDataHex('81'), '4f');
  assert.strictEqual(pushDataHex('aabb'), '02aabb');
  assert.strictEqual(pushDataHex('aa'.repeat(76)).slice(0, 4), '4c4c');
});
