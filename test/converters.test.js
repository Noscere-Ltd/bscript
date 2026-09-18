// Stack values are numbers, 0x-prefixed byte strings, or plain text. These
// tests pin down how the three converters read each of them.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter } = require('./helpers');

const interp = new ScriptInterpreter();

test('numToHex encodes little-endian sign-magnitude, minimally', () => {
  assert.strictEqual(interp.numToHex(0), '');
  assert.strictEqual(interp.numToHex(1), '01');
  assert.strictEqual(interp.numToHex(-1), '81');
  assert.strictEqual(interp.numToHex(127), '7f');
  assert.strictEqual(interp.numToHex(128), '8000');   // sign bit forces a pad byte
  assert.strictEqual(interp.numToHex(-128), '8080');
  assert.strictEqual(interp.numToHex(255), 'ff00');
  assert.strictEqual(interp.numToHex(256), '0001');
  assert.strictEqual(interp.numToHex(1000), 'e803');
  assert.strictEqual(interp.numToHex(10000), '1027');
});

test('hexToNum reverses numToHex', () => {
  const values = [0n, 1n, -1n, 127n, 128n, -128n, 255n, 256n, 1000n, -1000n, 10000n,
    2n ** 32n, 2n ** 63n - 1n, -(2n ** 63n), 2n ** 100n];
  for (const value of values) {
    assert.strictEqual(interp.hexToNum(interp.numToHex(value)), value, `round-trip ${value}`);
  }
});

test('hexToNum reads fixed-width fields', () => {
  assert.strictEqual(interp.hexToNum('e8030000'), 1000n);
  assert.strictEqual(interp.hexToNum('1027000000000000'), 10000n);
  assert.strictEqual(interp.hexToNum(''), 0n);
});

test('toNumber decodes byte strings instead of guessing decimal', () => {
  // Regression: parseInt('0x0a', 10) is 0, so every arithmetic op silently
  // treated byte operands as zero.
  assert.strictEqual(interp.toNumber('0x0a'), 10n);
  assert.strictEqual(interp.toNumber('0x1027'), 10000n);
  assert.strictEqual(interp.toNumber('0x81'), -1n);
  assert.strictEqual(interp.toNumber('0x'), 0n);
  assert.strictEqual(interp.toNumber(42), 42n);
  assert.strictEqual(interp.toNumber('42'), 42n);
  assert.strictEqual(interp.toNumber(true), 1n);
});

test('toNumber refuses values that are not numbers', () => {
  assert.throws(() => interp.toNumber('hello'), /Cannot convert 'hello' to a number/);
});

test('toBool treats all-zero bytes as false', () => {
  // Regression: '0x00' is a non-empty JS string, so verify() passed on it.
  assert.strictEqual(interp.toBool('0x00'), false);
  assert.strictEqual(interp.toBool('0x0000'), false);
  assert.strictEqual(interp.toBool('0x'), false);
  assert.strictEqual(interp.toBool('0x80'), false);    // negative zero
  assert.strictEqual(interp.toBool('0x0080'), false);
  assert.strictEqual(interp.toBool('0x01'), true);
  assert.strictEqual(interp.toBool('0x8001'), true);   // sign bit is not the last byte
  assert.strictEqual(interp.toBool(0), false);
  assert.strictEqual(interp.toBool(1), true);
});

test('toHexString gives every value a byte view', () => {
  assert.strictEqual(interp.toHexString('0xdeadbeef'), 'deadbeef');
  assert.strictEqual(interp.toHexString('deadbeef'), 'deadbeef');
  assert.strictEqual(interp.toHexString(1000), 'e803');
  assert.strictEqual(interp.toHexString(0), '');
  assert.strictEqual(interp.toHexString('hi'), '6869');
});

test('isHexValue only accepts 0x-prefixed hex', () => {
  assert.strictEqual(interp.isHexValue('0xdead'), true);
  assert.strictEqual(interp.isHexValue('0x'), true);
  assert.strictEqual(interp.isHexValue('dead'), false);
  assert.strictEqual(interp.isHexValue('0xzz'), false);
  assert.strictEqual(interp.isHexValue(1), false);
});
