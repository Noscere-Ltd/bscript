// Constants and stack manipulation: 23 opcodes that only move items around.

const { test } = require('node:test');
const assert = require('node:assert');
const { stack, failure, exec } = require('./helpers');

test('constants push 0 and 1', async () => {
  assert.deepStrictEqual(await stack('false true 0 1'), [0, 1, 0, 1]);
});

test('number and hex literals push as written', async () => {
  assert.deepStrictEqual(await stack('42 -7 0xdeadbeef'), [42, -7, '0xdeadbeef']);
});

test('drop, dup and nip', async () => {
  assert.deepStrictEqual(await stack('1 2 drop'), [1]);
  assert.deepStrictEqual(await stack('1 2 dup'), [1, 2, 2]);
  assert.deepStrictEqual(await stack('1 2 nip'), [2]);
});

test('over, swap and tuck', async () => {
  assert.deepStrictEqual(await stack('1 2 over'), [1, 2, 1]);
  assert.deepStrictEqual(await stack('1 2 swap'), [2, 1]);
  assert.deepStrictEqual(await stack('1 2 tuck'), [2, 1, 2]);
});

test('rot moves the third item to the top', async () => {
  assert.deepStrictEqual(await stack('1 2 3 rot'), [2, 3, 1]);
});

test('pick copies the nth item, roll moves it', async () => {
  assert.deepStrictEqual(await stack('1 2 3 0 pick'), [1, 2, 3, 3]);
  assert.deepStrictEqual(await stack('1 2 3 2 pick'), [1, 2, 3, 1]);
  assert.deepStrictEqual(await stack('1 2 3 2 roll'), [2, 3, 1]);
  assert.deepStrictEqual(await stack('1 2 3 0 roll'), [1, 2, 3]);
});

test('pick and roll reject a depth the stack cannot reach', async () => {
  assert.match(await failure('1 2 5 pick'), /Cannot execute 'pick'/);
  assert.match(await failure('1 2 5 roll'), /Invalid roll depth/);
  assert.match(await failure('1 2 -1 roll'), /Invalid roll depth/);
});

test('ifDup duplicates only a true value', async () => {
  assert.deepStrictEqual(await stack('3 ifDup'), [3, 3]);
  assert.deepStrictEqual(await stack('0 ifDup'), [0]);
  assert.deepStrictEqual(await stack('ifDup', ['0x00']), ['0x00']);
});

test('depth counts the main stack only', async () => {
  assert.deepStrictEqual(await stack('depth'), [0]);
  assert.deepStrictEqual(await stack('1 2 depth'), [1, 2, 2]);
  assert.deepStrictEqual(await stack('1 toAltStack depth'), [0]);
});

test('the alt stack round-trips values', async () => {
  assert.deepStrictEqual(await stack('1 2 toAltStack'), [1]);
  assert.deepStrictEqual(await stack('1 2 toAltStack fromAltStack'), [1, 2]);

  const interp = await exec('7 toAltStack');
  assert.deepStrictEqual(interp.altStack, [7]);
});

test('the two-item stack ops', async () => {
  assert.deepStrictEqual(await stack('1 2 3 4 2drop'), [1, 2]);
  assert.deepStrictEqual(await stack('1 2 2dup'), [1, 2, 1, 2]);
  assert.deepStrictEqual(await stack('1 2 3 3dup'), [1, 2, 3, 1, 2, 3]);
  assert.deepStrictEqual(await stack('1 2 3 4 2over'), [1, 2, 3, 4, 1, 2]);
  assert.deepStrictEqual(await stack('1 2 3 4 5 6 2rot'), [3, 4, 5, 6, 1, 2]);
  assert.deepStrictEqual(await stack('1 2 3 4 2swap'), [3, 4, 1, 2]);
});

test('an empty stack reports which opcode could not run', async () => {
  assert.match(await failure('dup'), /Cannot execute 'dup'/);
  assert.match(await failure('1 2 3dup'), /Cannot execute '3dup' - insufficient stack items\. Required: 3, available: 2/);
});

test('unknown opcodes are rejected', async () => {
  assert.match(await failure('frobnicate'), /Unknown opcode: frobnicate/);
});
