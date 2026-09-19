// Script numbers are arbitrary width. Doubles lose whole satoshis above 2^53,
// and an amount read out of a sighash preimage is exactly that size, so the
// stack holds BigInt and these tests say so without the narrowing the other
// opcode tests use.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter, opcodeInterpreter, failure, top } = require('./helpers');

const run = async (script, initialStack = []) => {
  const interp = opcodeInterpreter();
  const result = await interp.run(script, initialStack);
  assert.ok(result.success, `script failed: ${result.error}`);
  return interp.mainStack;
};

test('arithmetic results are bigints, not doubles', async () => {
  assert.deepStrictEqual(await run('2 3 add'), [5n]);
  assert.deepStrictEqual(await run('1'), [1n]);
  assert.deepStrictEqual(await run('0'), [0n]);
  assert.deepStrictEqual(await run('3 4 numEqual'), [0n]);
  assert.deepStrictEqual(await run('1 2 3 depth'), [1n, 2n, 3n, 3n]);
  assert.deepStrictEqual(await run('size', ['0xaabbcc']), ['0xaabbcc', 3n]);
});

test('a number above 2^53 keeps every digit', async () => {
  // 9007199254740993 is the first odd integer a double cannot hold
  assert.strictEqual((await run('9007199254740992 1 add'))[0], 9007199254740993n);
  assert.strictEqual((await run('9007199254740993 1 sub'))[0], 9007199254740992n);
  assert.strictEqual((await run('9007199254740993 1 numEqual'))[0], 0n);
});

test('an eight-byte amount from a preimage survives arithmetic', async () => {
  // 0xffffffffffffff7f is 9223372036854775807, the largest 8-byte amount
  const max = '0xffffffffffffff7f';
  assert.strictEqual((await run('bin2num', [max]))[0], 9223372036854775807n);
  assert.strictEqual((await run('bin2num 1 add', [max]))[0], 9223372036854775808n);
  assert.strictEqual((await run('bin2num 2 mul', [max]))[0], 18446744073709551614n);
});

test('num2bin and bin2num round-trip a number no double can hold', async () => {
  assert.strictEqual(await top('9007199254740993 8 num2bin'), '0x0100000000002000');
  assert.strictEqual((await run('9007199254740993 8 num2bin bin2num'))[0], 9007199254740993n);
});

test('the numeric shifts work past 2^53', async () => {
  assert.strictEqual((await run('1 60 lShiftNum'))[0], 1152921504606846976n);
  assert.strictEqual((await run('1 60 lShiftNum 59 rShiftNum'))[0], 2n);
  assert.strictEqual((await run('-1 60 lShiftNum'))[0], -1152921504606846976n);
});

test('a literal too large for a double is parsed exactly', async () => {
  const interp = new ScriptInterpreter();
  assert.strictEqual(interp.parseNumber('9007199254740993'), 9007199254740993n);
  assert.strictEqual(interp.numToHex(9007199254740993n), '01000000000020');
  assert.strictEqual(interp.hexToNum('01000000000020'), 9007199254740993n);
});

test('the initial stack takes plain numbers and makes them script numbers', async () => {
  assert.deepStrictEqual(await run('add', [2, 3]), [5n]);
});

test('division and modulo still truncate toward zero', async () => {
  assert.strictEqual((await run('-100 7 div'))[0], -14n);
  assert.strictEqual((await run('-100 7 mod'))[0], -2n);
  assert.match(await failure('1 0 div'), /Division by zero/);
});
