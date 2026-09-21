// OP_PUSH_TX: the checkPreimage binding, checked against real consensus.
//
// Every expectation here goes through Spend.validate(), the @bsv/sdk
// interpreter, on a transaction whose preimage is computed the way a node
// computes it. A hand-derived expectation would only prove that the test and
// the interpreter share a misreading.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Spend, LockingScript, UnlockingScript, TransactionSignature } = require('@bsv/sdk');
const { ScriptInterpreter, compileInstructionsToHex } = require('./helpers');
const { CHECK_PREIMAGE_BINDING_HEX } = require('../src/renderer/push-tx-binding');

const SIGHASH_ALL_FORKID = 0x41;
const EXAMPLES = path.join(__dirname, '..', 'examples');

// The spend under test: one input, one output, no other inputs.
const context = ({ version, lockTime, satoshis }) => ({
  sourceTXID: 'ab'.repeat(32),
  sourceOutputIndex: 0,
  sourceSatoshis: satoshis,
  transactionVersion: version,
  otherInputs: [],
  outputs: [{ satoshis: satoshis - 500, lockingScript: LockingScript.fromHex('51') }],
  inputIndex: 0,
  inputSequence: 0xffffffff,
  lockTime
});

const preimageOf = (ctx, lockingHex) => Buffer.from(
  TransactionSignature.format({
    ...ctx,
    subscript: LockingScript.fromHex(lockingHex),
    scope: SIGHASH_ALL_FORKID
  })
).toString('hex');

// Run the spend through @bsv/sdk. Returns null on success, the error otherwise.
function validate(ctx, lockingHex, preimageHex) {
  const spend = new Spend({
    ...ctx,
    lockingScript: LockingScript.fromHex(lockingHex),
    unlockingScript: UnlockingScript.fromHex(compileInstructionsToHex(['0x' + preimageHex]))
  });
  try {
    spend.validate();
    return null;
  } catch (err) {
    return err.message;
  }
}

// Compile a .bscript source the way the app does.
async function compile(source) {
  const interp = new ScriptInterpreter();
  return compileInstructionsToHex(await interp.parse(source, []));
}

// The renderer's constant is a hex literal. This pins it against the Runar
// compiler's own opcode-level assembly of the same binding, vendored under
// src/vendor/runar/compiler. Both are now frozen at the same upstream commit,
// so this catches an edit to either copy, not upstream drift; re-syncing the
// vendored tree is what catches that.
test('the vendored binding matches the Runar compiler construction', async () => {
  const runar = await import('../src/vendor/runar/compiler/oppushtx-codegen.js');
  assert.strictEqual(CHECK_PREIMAGE_BINDING_HEX, runar.CHECK_PREIMAGE_BINDING_HEX);
});

test('checkPreimage compiles to the binding and disassembles back', async () => {
  const hex = await compile('checkPreimage');
  assert.strictEqual(hex, CHECK_PREIMAGE_BINDING_HEX);
});

test('covenant-locktime accepts the real preimage of a conforming spend', async () => {
  const locking = await compile(fs.readFileSync(path.join(EXAMPLES, 'covenant-locktime.bscript'), 'utf8'));

  for (const version of [1, 2]) {
    const ctx = context({ version, lockTime: 1000, satoshis: 20000 });
    assert.strictEqual(validate(ctx, locking, preimageOf(ctx, locking)), null,
      `rejected at transaction version ${version}`);
  }
});

test('covenant-locktime rejects a preimage with a forged locktime', async () => {
  // This is F23. Before the binding, the spender supplied the signature, so a
  // preimage claiming any locktime it liked passed consensus.
  const locking = await compile(fs.readFileSync(path.join(EXAMPLES, 'covenant-locktime.bscript'), 'utf8'));

  for (const version of [1, 2]) {
    const ctx = context({ version, lockTime: 0, satoshis: 20000 });
    const real = preimageOf(ctx, locking);

    // Rewrite nLocktime, the 4 bytes at size-8, to 1000. The covenant's own
    // check would pass on this; the binding is what stops it.
    const forged = real.slice(0, real.length - 16) + 'e8030000' + real.slice(real.length - 8);
    assert.notStrictEqual(forged, real);

    assert.notStrictEqual(validate(ctx, locking, forged), null,
      `a forged locktime was accepted at transaction version ${version}`);
  }
});

test('covenant-locktime rejects a real preimage that does not meet the covenant', async () => {
  const locking = await compile(fs.readFileSync(path.join(EXAMPLES, 'covenant-locktime.bscript'), 'utf8'));

  for (const version of [1, 2]) {
    const ctx = context({ version, lockTime: 0, satoshis: 20000 });
    assert.notStrictEqual(validate(ctx, locking, preimageOf(ctx, locking)), null,
      `locktime 0 was accepted at transaction version ${version}`);
  }
});

// Every shipped covenant: a preimage that does not match the spend is
// rejected by the binding itself, whatever the covenant around it checks.
const BINDING_REJECTION = /OP_CHECKSIGVERIFY requires that a valid signature is provided/;

const COVENANTS = [
  { name: 'covenant-locktime', extra: [], stoppedBy: BINDING_REJECTION },
  { name: 'covenant-output-hash', extra: [], stoppedBy: BINDING_REJECTION },
  { name: 'op-push-tx', extra: [], stoppedBy: BINDING_REJECTION },
  // This one checks the owner's signature before it looks at the preimage,
  // so consensus stops the spend one step earlier.
  { name: 'covenant-rate-limit', extra: ['0xaa'], stoppedBy: /signature format is invalid/ }
];

for (const { name, extra, stoppedBy } of COVENANTS) {
  test(`${name} rejects a forged preimage at both versions`, async () => {
    const locking = await compile(fs.readFileSync(path.join(EXAMPLES, `${name}.bscript`), 'utf8'));

    for (const version of [1, 2]) {
      const ctx = context({ version, lockTime: 1000, satoshis: 20000 });
      const real = preimageOf(ctx, locking);
      // Flip the first byte of nLocktime, which every one of these reads
      const forged = real.slice(0, real.length - 16) + 'ff' + real.slice(real.length - 14);
      assert.notStrictEqual(forged, real);

      const unlocking = compileInstructionsToHex([...extra, '0x' + forged]);
      const spend = new Spend({
        ...ctx,
        lockingScript: LockingScript.fromHex(locking),
        unlockingScript: UnlockingScript.fromHex(unlocking)
      });

      let error = null;
      try {
        spend.validate();
      } catch (err) {
        error = err.message;
      }

      assert.notStrictEqual(error, null,
        `${name} accepted a forged preimage at transaction version ${version}`);
      assert.match(error, stoppedBy,
        `${name} at version ${version} was rejected for an unexpected reason`);
    }
  });
}

// The counter-chain example has its own file: test/counter-chain.test.js
