// String ops (cat, split, num2bin, bin2num, size) plus the run() regression
// that hid every other defect: these all count bytes, not hex characters.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter, PREIMAGE, exec, stack, failure, top } = require('./helpers');

test('run() executes the script instead of returning early', async () => {
  // Regression: run() called parse() without awaiting it, so every script
  // "succeeded" with an empty stack and zero instructions.
  const interp = await exec('1\n1\nadd\n2\nequal');
  assert.strictEqual(interp.instructions.length, 5);
  assert.deepStrictEqual(interp.mainStack, [1]);
});

test('size counts bytes, not hex characters', async () => {
  assert.strictEqual(await top('size', [PREIMAGE]), 181);
  assert.strictEqual(await top('size', [PREIMAGE]), (PREIMAGE.length - 2) / 2);
});

test('size leaves its operand on the stack', async () => {
  assert.deepStrictEqual(await stack('size', ['0xdeadbeef']), ['0xdeadbeef', 4]);
});

test('size of a number is its script encoding', async () => {
  assert.strictEqual(await top('size', [0]), 0);
  assert.strictEqual(await top('size', [1]), 1);
  assert.strictEqual(await top('size', [255]), 2);   // sign bit forces a pad byte
  assert.strictEqual(await top('size', ['hello']), 5);
});

test('split cuts at a byte offset and keeps both halves hex', async () => {
  assert.deepStrictEqual(await stack('2 split', ['0xaabbccdd']), ['0xaabb', '0xccdd']);
  assert.deepStrictEqual(await stack('0 split', ['0xaabb']), ['0x', '0xaabb']);
  assert.deepStrictEqual(await stack('2 split', ['0xaabb']), ['0xaabb', '0x']);
});

test('split past the end of the item throws', async () => {
  assert.match(await failure('4 split', ['0xdead']), /Cannot split at byte 4 - item is 2 bytes/);
  assert.match(await failure('-1 split', ['0xdead']), /Cannot split at byte -1/);
});

test('cat concatenates bytes', async () => {
  assert.strictEqual(await top('cat', ['0xdead', '0xbeef']), '0xdeadbeef');
  assert.strictEqual(await top('cat', ['0x', '0xbeef']), '0xbeef');
  assert.strictEqual(await top('cat', [1, 2]), '0x0102');
});

test('cat and split invert each other', async () => {
  const joined = await top('cat', ['0xaabb', '0xccdd']);
  assert.deepStrictEqual(await stack('2 split', [joined]), ['0xaabb', '0xccdd']);
});

test('num2bin writes little-endian bytes of the requested width', async () => {
  assert.strictEqual(await top('1000 4 num2bin'), '0xe8030000');
  assert.strictEqual(await top('0 4 num2bin'), '0x00000000');
  assert.strictEqual(await top('-1 2 num2bin'), '0x0180');
});

test('num2bin rejects a number too wide for the requested size', async () => {
  assert.match(await failure('100000 2 num2bin'), /Cannot fit 100000 into 2 bytes/);
  assert.match(await failure('1 0 num2bin'), /Cannot fit 1 into 0 bytes/);
});

test('bin2num reads little-endian sign-magnitude bytes', async () => {
  assert.strictEqual(await top('bin2num', ['0xe8030000']), 1000);
  assert.strictEqual(await top('bin2num', ['0x0180']), -1);
  assert.strictEqual(await top('bin2num', ['0x']), 0);
});

test('num2bin and bin2num round-trip', async () => {
  for (const value of [0, 1, 255, 256, 10000, -42]) {
    const encoded = await top(`${value} 8 num2bin`);
    assert.strictEqual(await top('bin2num', [encoded]), value, `round-trip ${value}`);
  }
});

test('hash opcodes hash the bytes of a hex item, not its text', async () => {
  const crypto = require('node:crypto');
  const expected = crypto.createHash('sha256')
    .update(crypto.createHash('sha256').update(Buffer.from('deadbeef', 'hex')).digest())
    .digest('hex');
  assert.strictEqual(await top('hash256', ['0xdeadbeef']), '0x' + expected);
});

test('toHashBuffer decodes hex items and leaves text alone', () => {
  const { toHashBuffer } = require('../src/main/hash-input');
  assert.deepStrictEqual(toHashBuffer('0xdeadbeef'), Buffer.from('deadbeef', 'hex'));
  assert.deepStrictEqual(toHashBuffer('hello'), Buffer.from('hello', 'utf8'));
  assert.deepStrictEqual(toHashBuffer(1000), Buffer.from('1000', 'utf8'));
});
