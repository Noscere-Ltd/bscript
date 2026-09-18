// Crypto: the five hash opcodes plus the six signature opcodes.
//
// Signature checking has two modes. With enableSignatures off (the default)
// the signature opcodes are simulated and always succeed; these tests pin down
// both that simulation and the guard that replaces it when the setting is on
// but no transaction context has been supplied.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { ScriptInterpreter, stack, failure, top } = require('./helpers');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

test('the hash opcodes match node crypto on the same bytes', async () => {
  const bytes = Buffer.from('deadbeef', 'hex');

  assert.strictEqual(await top('sha256', ['0xdeadbeef']),
    sha256(bytes).toString('hex'));
  assert.strictEqual(await top('sha1', ['0xdeadbeef']),
    crypto.createHash('sha1').update(bytes).digest('hex'));
  assert.strictEqual(await top('ripemd160', ['0xdeadbeef']),
    crypto.createHash('ripemd160').update(bytes).digest('hex'));
  assert.strictEqual(await top('hash256', ['0xdeadbeef']),
    sha256(sha256(bytes)).toString('hex'));
  assert.strictEqual(await top('hash160', ['0xdeadbeef']),
    crypto.createHash('ripemd160').update(sha256(bytes)).digest('hex'));
});

test('hash opcodes consume their operand', async () => {
  const items = await stack('1 sha256', []);
  assert.strictEqual(items.length, 1);
});

test('hash160 is ripemd160 of sha256', async () => {
  const once = await top('sha256', ['0xdeadbeef']);
  const twice = await top('ripemd160', ['0x' + once]);
  assert.strictEqual(await top('hash160', ['0xdeadbeef']), twice);
});

test('checkSig is simulated by default', async () => {
  assert.deepStrictEqual(await stack('checkSig', ['0xdead', '0xbeef']), [1]);
  assert.deepStrictEqual(await stack('checkSigVerify 7', ['0xdead', '0xbeef']), [7]);
});

test('checkDataSig is simulated by default', async () => {
  assert.deepStrictEqual(await stack('checkDataSig', ['0xa1', '0xb2', '0xc3']), [1]);
  assert.deepStrictEqual(await stack('checkDataSigVerify 7', ['0xa1', '0xb2', '0xc3']), [7]);
});

test('checkMultiSig consumes the dummy, the sigs and the keys', async () => {
  // Stack, bottom to top: dummy, sig1, sig2, 2, key1, key2, key3, 3
  const spent = ['0x00', '0xa1', '0xa2', 2, '0xb1', '0xb2', '0xb3', 3];
  assert.deepStrictEqual(await stack('checkMultiSig', spent), [1]);
  assert.deepStrictEqual(await stack('checkMultiSigVerify 7', ['0x00', '0xa1', 1, '0xb1', 1]), [7]);
});

test('signature opcodes demand a transaction context once signatures are on', async () => {
  const interp = new ScriptInterpreter();
  interp.enableSignatures = true;
  const result = await interp.run('checkSig', ['0xdead', '0xbeef']);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /checkSig requires transaction context/);
});

test('checkSig pops the pubkey before the signature', async () => {
  // checkPreimage relies on this: it pushes G as the pubkey after the
  // signature, so the signature has to be the second item popped.
  const seen = [];
  const realVerify = window.bsv.verifySig;
  window.bsv.verifySig = async (sigHex, sighash, pubKeyHex) => {
    seen.push({ sigHex, pubKeyHex });
    return { success: true, valid: true };
  };

  try {
    const interp = new ScriptInterpreter();
    interp.enableSignatures = true;
    interp.setTransactionContext({ sighash: 'ab'.repeat(32) });
    const result = await interp.run('checkSig', ['0x1111', '0x2222']);
    assert.ok(result.success, result.error);
  } finally {
    window.bsv.verifySig = realVerify;
  }

  assert.deepStrictEqual(seen, [{ sigHex: '1111', pubKeyHex: '2222' }]);
});

test('an empty stack is reported, not silently simulated', async () => {
  assert.match(await failure('checkSig'), /Cannot execute 'checkSig'/);
  assert.match(await failure('checkMultiSig'), /Cannot execute 'checkMultiSig'/);
});
