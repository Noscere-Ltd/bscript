// The opcodes the Genesis upgrade restored, and the two Bitcoin Cash opcodes
// that are invalid on BSV. Behaviour is compared against @bsv/sdk in
// test/differential.test.js; this file pins the names and byte values.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter, failure, top, stack, compileInstructionsToHex, disassemble } = require('./helpers');

const compile = async (script) => {
  const interp = new ScriptInterpreter();
  await interp.parse(script, []);
  return compileInstructionsToHex(interp.instructions);
};

test('the restored opcodes compile to their protocol byte values', async () => {
  const bytes = {
    ver: '62', verIf: '65', verNotIf: '66',
    '2mul': '8d', '2div': '8e',
    substr: 'b3', left: 'b4', right: 'b5',
    lShiftNum: 'b6', rShiftNum: 'b7'
  };

  for (const [name, hex] of Object.entries(bytes)) {
    assert.strictEqual(await compile(name), hex, name);
    assert.strictEqual(disassemble(hex).trim().toLowerCase().replace('op_', ''),
      name.toLowerCase(), `${name} disassembles back`);
  }
});

test('0xba and 0xbb are not opcodes on BSV', async () => {
  // OP_CHECKDATASIG and OP_CHECKDATASIGVERIFY are Bitcoin Cash opcodes
  assert.match(await failure('checkDataSig'), /Unknown opcode/);
  assert.match(await failure('checkDataSigVerify'), /Unknown opcode/);
  await assert.rejects(() => compile('checkDataSig'), /Unknown/);
});

test('ver pushes the version the interpreter is running under', async () => {
  assert.strictEqual(await top('ver'), '0x01000000');
  assert.strictEqual(await top('ver', [], 2), '0x02000000');
});

test('verIf matches only a four-byte item equal to that version', async () => {
  assert.deepStrictEqual(await stack('0x01000000 verIf 11 else 22 endIf'), [11]);
  assert.deepStrictEqual(await stack('0x02000000 verIf 11 else 22 endIf'), [22]);
  // A one-byte 1 is the same number but not the same item, so it never matches
  assert.deepStrictEqual(await stack('0x01 verIf 11 else 22 endIf'), [22]);
  assert.deepStrictEqual(await stack('0x01000000 verNotIf 11 else 22 endIf'), [22]);
  assert.deepStrictEqual(await stack('0x01000000 verIf 11 else 22 endIf', [], 2), [22]);
});

test('verIf inside a skipped branch consumes nothing and stays balanced', async () => {
  // A conditional in a branch that is not taken must still open and close its
  // own block, or every endIf after it lands on the wrong one.
  assert.deepStrictEqual(await stack('0 if 0x01000000 verIf 11 endIf else 33 endIf'), [33]);
});

test('substr, left and right cut bytes out of an item', async () => {
  assert.strictEqual(await top('0x11223344 1 2 substr'), '0x2233');
  assert.strictEqual(await top('0x11223344 2 left'), '0x1122');
  assert.strictEqual(await top('0x11223344 2 right'), '0x3344');
  assert.match(await failure('0x11223344 1 4 substr'), /substr offset/);
  assert.match(await failure('0x11223344 5 left'), /left length/);
  assert.match(await failure('0x11223344 5 right'), /right length/);
});

test('the numeric shifts truncate toward zero', async () => {
  assert.strictEqual(await top('1 4 lShiftNum'), 16);
  assert.strictEqual(await top('-1 4 lShiftNum'), -16);
  assert.strictEqual(await top('-7 1 rShiftNum'), -3);
  assert.strictEqual(await top('7 1 rShiftNum'), 3);
  assert.match(await failure('1 -1 lShiftNum'), /must not be negative/);
  assert.match(await failure('1 -1 rShiftNum'), /must not be negative/);
});

test('2mul and 2div', async () => {
  assert.strictEqual(await top('5 2mul'), 10);
  assert.strictEqual(await top('-5 2div'), -2);
});
