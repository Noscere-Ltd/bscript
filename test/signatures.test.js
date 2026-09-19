// Real signatures, signed with @bsv/sdk and checked by src/main/signature.js,
// the module the main process uses. A signature's last byte is its sighash
// type, and bit 0x20 selects the original digest algorithm instead of BIP-143,
// so the same DER bytes cover a different message under each scope.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  PrivateKey, Transaction, TransactionSignature, Script, BigNumber, ECDSA,
  UnlockingScript, LockingScript, Spend
} = require('@bsv/sdk');
const { sighashFor, verifySig, verifyMultiSig } = require('../src/main/signature');
const { ScriptInterpreter, narrowAll } = require('./helpers');

const BIP143 = 0x41; // SIGHASH_ALL | FORKID
const OTDA = 0x61;   // SIGHASH_ALL | FORKID | CHRONICLE, the original algorithm

const key = PrivateKey.fromHex('01'.repeat(32));
const pubKeyHex = key.toPublicKey().toString();
const lockingHex = Script.fromASM(`${pubKeyHex} OP_CHECKSIG`).toHex();

function spendingTx(version = 1) {
  const tx = new Transaction(version);
  tx.addInput({
    sourceTXID: 'ab'.repeat(32),
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript(),
    sequence: 0xffffffff
  });
  tx.addOutput({ satoshis: 900, lockingScript: LockingScript.fromHex(lockingHex) });
  return tx;
}

function context(version = 1) {
  return {
    txHex: spendingTx(version).toHex(),
    inputIndex: 0,
    prevScriptHex: lockingHex,
    satoshis: 1000
  };
}

// Sign the sighash this scope selects, and return the signature in the form a
// script pushes: DER followed by the sighash type byte.
function signUnder(scope, ctx = context(), { highS = false } = {}) {
  // The sighash is the message hash, so it is signed as it stands
  const sig = ECDSA.sign(new BigNumber(sighashFor(ctx, scope), 16), key, true);
  let s = sig.s;
  if (highS) {
    const n = new BigNumber('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 16);
    s = n.sub(s);
  }
  const ts = new TransactionSignature(sig.r, s, scope);
  return Buffer.from(ts.toChecksigFormat()).toString('hex');
}

// The oracle: the same locking script and signature through Spend.
function throughSpend(unlockingASM, version = 1,
  { locking = lockingHex, tx = spendingTx(version), inputIndex = 0 } = {}) {
  const spend = new Spend({
    sourceTXID: 'ab'.repeat(32),
    sourceOutputIndex: 0,
    sourceSatoshis: 1000,
    lockingScript: LockingScript.fromHex(locking),
    transactionVersion: version,
    otherInputs: tx.inputs.filter((_, i) => i !== inputIndex),
    outputs: tx.outputs,
    inputIndex,
    unlockingScript: UnlockingScript.fromASM(unlockingASM),
    inputSequence: 0xffffffff,
    lockTime: 0
  });

  try {
    return { ok: spend.validate() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

test('a signature verifies under the scope it was made with', async () => {
  // The 0x20 scope is only valid after Chronicle, which version > 1 signals, so
  // each scope is checked on the lowest version that admits it.
  for (const [scope, version] of [[BIP143, 1], [OTDA, 2]]) {
    const signatureHex = signUnder(scope, context(version));
    const result = verifySig({
      signatureHex, pubKeyHex, txContext: context(version), requireLowS: true });

    assert.ok(result.success, result.error);
    assert.strictEqual(result.valid, true, `scope 0x${scope.toString(16)}`);
    assert.strictEqual(result.scope, scope);
  }
});

test('the same bytes under the wrong scope cover a different message', async () => {
  // Only the sighash byte changes, so nothing but the choice of digest
  // algorithm can explain the difference. Version 2 admits both scopes, so the
  // Chronicle gate cannot be what rejects these.
  for (const [made, claimed] of [[BIP143, OTDA], [OTDA, BIP143]]) {
    const signatureHex = signUnder(made, context(2)).slice(0, -2) + claimed.toString(16);
    const result = verifySig({
      signatureHex, pubKeyHex, txContext: context(2), requireLowS: true });

    assert.ok(result.success, result.error);
    assert.strictEqual(result.valid, false, `made 0x${made.toString(16)}, claimed 0x${claimed.toString(16)}`);
  }
});

test('the Chronicle scope is refused on a spend that predates it', () => {
  // @bsv/sdk gates the 0x20 scope on Chronicle and reads version > 1 as
  // activated, so a version 1 spend claiming it must fail here too rather than
  // be reported valid against a node that would refuse it.
  const signatureHex = signUnder(OTDA, context(1));

  const result = verifySig({
    signatureHex, pubKeyHex, txContext: context(1), requireLowS: true });
  assert.strictEqual(result.success, false);
  assert.match(result.error, /invalid before Chronicle/);

  assert.strictEqual(throughSpend(signatureHex, 1).ok, false);
});

test('@bsv/sdk reaches the same verdict on the same inputs', () => {
  // @bsv/sdk accepts the 0x20 scope only after Chronicle, and with no explicit
  // verify flags it reads version > 1 as Chronicle having activated, so each
  // scope is checked on the lowest version that admits it.
  for (const [scope, version] of [[BIP143, 1], [OTDA, 2]]) {
    const signatureHex = signUnder(scope, context(version));
    assert.strictEqual(throughSpend(signatureHex, version).ok, true, `scope 0x${scope.toString(16)}`);
  }

  // Version 2 admits both scopes, so a swapped scope byte fails on the digest
  // it selects rather than on the Chronicle gate.
  for (const [made, claimed] of [[BIP143, OTDA], [OTDA, BIP143]]) {
    const signatureHex = signUnder(made, context(2)).slice(0, -2) + claimed.toString(16);
    assert.strictEqual(throughSpend(signatureHex, 2).ok, false,
      `made 0x${made.toString(16)}, claimed 0x${claimed.toString(16)}`);
  }
});

test('the interpreter verifies both scopes in transaction mode', async () => {
  for (const [scope, version] of [[BIP143, 1], [OTDA, 2]]) {
    const interp = new ScriptInterpreter();
    interp.applyFinalRules = false;
    interp.enableSignatures = true;
    interp.setTransactionContext(context(version));

    const result = await interp.run(
      `0x${pubKeyHex} checkSig`, ['0x' + signUnder(scope, context(version))]);

    assert.ok(result.success, result.error);
    assert.deepStrictEqual(narrowAll(interp.mainStack), [1], `scope 0x${scope.toString(16)}`);
  }
});

test('the interpreter rejects a signature whose scope does not match', async () => {
  const interp = new ScriptInterpreter();
  interp.applyFinalRules = false;
  interp.enableSignatures = true;
  interp.setTransactionContext(context(2));

  const wrongScope = signUnder(BIP143, context(2)).slice(0, -2) + '61';
  const result = await interp.run(`0x${pubKeyHex} checkSig`, ['0x' + wrongScope]);

  assert.ok(result.success, result.error);
  assert.deepStrictEqual(narrowAll(interp.mainStack), [0]);
});

test('a signature after a codeSeparator covers only the script that follows', async () => {
  // The locking script is `0xdead drop codeSeparator <pubkey> checkSig`, so
  // the digest is taken over `<pubkey> checkSig` alone.
  const script = `0xdead drop codeSeparator 0x${pubKeyHex} checkSig`;
  const subscriptHex = Script.fromASM(`${pubKeyHex} OP_CHECKSIG`).toHex();
  const ctx = { ...context(), prevScriptHex: Script.fromASM(
    `dead OP_DROP OP_CODESEPARATOR ${pubKeyHex} OP_CHECKSIG`).toHex() };

  const sig = ECDSA.sign(
    new BigNumber(sighashFor({ ...ctx, subscriptHex }, BIP143), 16), key, true);
  const signatureHex = Buffer.from(
    new TransactionSignature(sig.r, sig.s, BIP143).toChecksigFormat()).toString('hex');

  const interp = new ScriptInterpreter();
  interp.applyFinalRules = false;
  interp.enableSignatures = true;
  interp.setTransactionContext(ctx);

  const result = await interp.run(script, ['0x' + signatureHex]);
  assert.ok(result.success, result.error);
  assert.deepStrictEqual(narrowAll(interp.mainStack), [1]);

  // The same signature against the whole script is a different message
  const whole = verifySig({ signatureHex, pubKeyHex, txContext: ctx, requireLowS: true });
  assert.strictEqual(whole.valid, false);

  // And @bsv/sdk, which applies the same rule, accepts the spend
  const spend = new Spend({
    sourceTXID: 'ab'.repeat(32),
    sourceOutputIndex: 0,
    sourceSatoshis: 1000,
    lockingScript: LockingScript.fromHex(ctx.prevScriptHex),
    transactionVersion: 1,
    otherInputs: [],
    outputs: spendingTx().outputs,
    inputIndex: 0,
    unlockingScript: UnlockingScript.fromASM(signatureHex),
    inputSequence: 0xffffffff,
    lockTime: 0
  });
  assert.strictEqual(spend.validate(), true);
});

test('version 1 rejects a high-S signature, version 2 takes it', () => {
  const signatureHex = signUnder(BIP143, context(), { highS: true });

  const strict = verifySig({ signatureHex, pubKeyHex, txContext: context(), requireLowS: true });
  assert.strictEqual(strict.success, false);
  assert.match(strict.error, /low S value/);

  // Same signature, same transaction, only the rule set differs
  const relaxed = verifySig({ signatureHex, pubKeyHex, txContext: context(), requireLowS: false });
  assert.ok(relaxed.success, relaxed.error);
  assert.strictEqual(relaxed.valid, true);
});

// 2-of-2 multisig. checkMultiSig pops keys and signatures top first, so the
// arrays handed to verifyMultiSig run in the reverse of script order.
const key2 = PrivateKey.fromHex('02'.repeat(32));
const pubKey2Hex = key2.toPublicKey().toString();
const multisigHex = Script.fromASM(`OP_2 ${pubKeyHex} ${pubKey2Hex} OP_2 OP_CHECKMULTISIG`).toHex();

function multisigVerdicts(sigsInScriptOrder, version) {
  const ctx = { ...context(version), prevScriptHex: multisigHex };
  const ours = verifyMultiSig({
    signaturesHex: [...sigsInScriptOrder].reverse(),
    pubKeysHex: [pubKey2Hex, pubKeyHex],
    txContext: ctx,
    requireLowS: version === 1
  });
  const asm = ['OP_0', ...sigsInScriptOrder.map((sig) => sig || 'OP_0')].join(' ');
  return { ours, spend: throughSpend(asm, version, { locking: multisigHex }) };
}

function multisigSignature(signer, version) {
  const ctx = { ...context(version), prevScriptHex: multisigHex };
  const sig = ECDSA.sign(new BigNumber(sighashFor(ctx, BIP143), 16), signer, true);
  return Buffer.from(
    new TransactionSignature(sig.r, sig.s, BIP143).toChecksigFormat()).toString('hex');
}

test('2-of-2 multisig with both signatures is valid, as it is in @bsv/sdk', () => {
  for (const version of [1, 2]) {
    const { ours, spend } = multisigVerdicts(
      [multisigSignature(key, version), multisigSignature(key2, version)], version);
    assert.ok(ours.success, ours.error);
    assert.strictEqual(ours.valid, true);
    assert.strictEqual(spend.ok, true, spend.error);
  }
});

test('2-of-2 multisig with one valid and one empty signature is not valid', () => {
  for (const version of [1, 2]) {
    for (const sigs of [
      [multisigSignature(key, version), ''],
      ['', multisigSignature(key2, version)]
    ]) {
      const { ours, spend } = multisigVerdicts(sigs, version);
      assert.ok(ours.success, ours.error);
      assert.strictEqual(ours.valid, false);
      assert.strictEqual(spend.ok, false);
    }
  }
});

test('2-of-2 multisig with two empty signatures is not valid', () => {
  for (const version of [1, 2]) {
    const { ours, spend } = multisigVerdicts(['', ''], version);
    assert.ok(ours.success, ours.error);
    assert.strictEqual(ours.valid, false);
    assert.strictEqual(spend.ok, false);
  }
});

test('a sighash base type that is not ALL, NONE or SINGLE is refused', () => {
  for (const version of [1, 2]) {
    for (const scope of [0x40, 0x44]) {
      const signatureHex = signUnder(scope, context(version));
      const result = verifySig({
        signatureHex, pubKeyHex, txContext: context(version), requireLowS: version === 1 });

      assert.strictEqual(result.success, false, `scope 0x${scope.toString(16)}`);
      assert.match(result.error, /signature hash type is invalid/);
      assert.strictEqual(throughSpend(signatureHex, version).ok, false);
    }
  }
});

test('multisig refuses an undefined sighash base type too', () => {
  const ctx = { ...context(2), prevScriptHex: multisigHex };
  const sign = (signer) => {
    const sig = ECDSA.sign(new BigNumber(sighashFor(ctx, 0x40), 16), signer, true);
    return Buffer.from(new TransactionSignature(sig.r, sig.s, 0x40).toChecksigFormat()).toString('hex');
  };
  const { ours, spend } = multisigVerdicts([sign(key), sign(key2)], 2);

  assert.strictEqual(ours.success, false);
  assert.match(ours.error, /signature hash type is invalid/);
  assert.strictEqual(spend.ok, false);
});

test('original-algorithm SIGHASH_SINGLE with no matching output signs the number one', () => {
  // Two inputs, one output, signing input 1. Both the legacy scope 0x03 and
  // the Chronicle scope 0x63 use the original algorithm.
  const tx = spendingTx(2);
  tx.addInput({
    sourceTXID: 'ab'.repeat(32),
    sourceOutputIndex: 1,
    unlockingScript: new UnlockingScript(),
    sequence: 0xffffffff
  });
  const ctx = { ...context(2), txHex: tx.toHex(), inputIndex: 1 };

  for (const scope of [0x03, 0x63]) {
    assert.strictEqual(sighashFor(ctx, scope), '01' + '00'.repeat(31));

    const one = new BigNumber([1, ...new Array(31).fill(0)]);
    const sig = ECDSA.sign(one, key, true);
    const signatureHex = Buffer.from(
      new TransactionSignature(sig.r, sig.s, scope).toChecksigFormat()).toString('hex');

    const result = verifySig({ signatureHex, pubKeyHex, txContext: ctx, requireLowS: false });
    assert.ok(result.success, result.error);
    assert.strictEqual(result.valid, true, `scope 0x${scope.toString(16)}`);
    assert.strictEqual(throughSpend(signatureHex, 2, { tx, inputIndex: 1 }).ok, true);
  }

  // BIP-143 SIGHASH_SINGLE has no such bug: the same signature is not valid
  assert.notStrictEqual(sighashFor(ctx, 0x43), '01' + '00'.repeat(31));
});
