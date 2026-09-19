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
const { sighashFor, verifySig } = require('../src/main/signature');
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
function throughSpend(signatureHex, version = 1) {
  const spend = new Spend({
    sourceTXID: 'ab'.repeat(32),
    sourceOutputIndex: 0,
    sourceSatoshis: 1000,
    lockingScript: LockingScript.fromHex(lockingHex),
    transactionVersion: version,
    otherInputs: [],
    outputs: spendingTx(version).outputs,
    inputIndex: 0,
    unlockingScript: UnlockingScript.fromASM(signatureHex),
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
