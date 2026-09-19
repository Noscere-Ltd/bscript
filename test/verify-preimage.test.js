// F42: Verify used to report MISMATCH on every checkPreimage script.
//
// The Rúnar ScriptVM executes the OP_PUSH_TX binding for real against a
// synthetic transaction of its own, so the documented dummy preimage fails
// there at OP_CHECKSIGVERIFY while the simulator, with no transaction context,
// waves it through. These tests pin the preimage that makes both engines
// check the same thing.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { preimageForScript } = require('../src/main/verify-preimage');
const { pushDataHex } = require('../src/shared/push-data');
const { ScriptInterpreter, compileInstructionsToHex } = require('./helpers');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const read = (name) => fs.readFileSync(path.join(EXAMPLES, `${name}.bscript`), 'utf8');

const compile = async (source) =>
  compileInstructionsToHex(await new ScriptInterpreter().parse(source, []));

// runar-testing is an optional peer here: the app links it, a bare checkout
// may not have it.
const loadVm = async (t) => {
  try {
    return await import(require.resolve('runar-testing'));
  } catch (err) {
    t.skip(`runar-testing is not resolvable here (${err.code || err.message})`);
    return null;
  }
};

test('the derived preimage satisfies the binding in the ScriptVM', async (t) => {
  const vmModule = await loadVm(t);
  if (!vmModule) return;
  const { ScriptVM, hexToBytes } = vmModule;

  const lockingHex = await compile(read('op-push-tx'));
  const { preimageHex } = await preimageForScript(lockingHex);

  const run = (itemHex) => new ScriptVM()
    .execute(hexToBytes(pushDataHex(itemHex)), hexToBytes(lockingHex));

  const documented = read('op-push-tx').match(/0x02000000[0-9a-f]+/)[0].slice(2);
  const withDummy = run(documented);
  assert.strictEqual(withDummy.success, false);
  assert.match(withDummy.error, /OP_CHECKSIGVERIFY/);

  const withDerived = run(preimageHex);
  assert.strictEqual(withDerived.success, true,
    `the derived preimage was rejected: ${withDerived.error}`);
});

test('every shipped covenant passes the binding with the derived preimage', async (t) => {
  const vmModule = await loadVm(t);
  if (!vmModule) return;
  const { ScriptVM, hexToBytes } = vmModule;

  for (const name of ['covenant-locktime', 'covenant-output-hash', 'op-push-tx']) {
    const lockingHex = await compile(read(name));
    const { preimageHex } = await preimageForScript(lockingHex);
    const result = new ScriptVM()
      .execute(hexToBytes(pushDataHex(preimageHex)), hexToBytes(lockingHex));

    // The covenant's own checks may still refuse this transaction; what must
    // not happen any more is a failure at the binding itself.
    assert.doesNotMatch(String(result.error || ''), /OP_CHECKSIGVERIFY/,
      `${name} still fails at the binding with the derived preimage`);
  }
});

test('the simulator checks the same preimage against the same digest', async () => {
  const lockingHex = await compile(read('op-push-tx'));
  const { preimageHex, sighashHex } = await preimageForScript(lockingHex);

  const interp = new ScriptInterpreter();
  interp.applyFinalRules = false;
  interp.setTransactionContext({ sighash: sighashHex });

  const accepted = await interp.run(read('op-push-tx'), ['0x' + preimageHex]);
  assert.ok(accepted.success, accepted.error);

  // Any other preimage is refused, which is the whole point of the binding
  const forged = preimageHex.slice(0, -8) + 'deadbeef';
  const refused = await interp.run(read('op-push-tx'), ['0x' + forged]);
  assert.strictEqual(refused.success, false);
  assert.match(refused.error, /checkPreimage failed/);
});

test('the derived preimage is the digest the sighash claims', async () => {
  const crypto = require('node:crypto');
  const { preimageHex, sighashHex } = await preimageForScript('51');
  const once = crypto.createHash('sha256').update(Buffer.from(preimageHex, 'hex')).digest();

  assert.strictEqual(crypto.createHash('sha256').update(once).digest('hex'), sighashHex);
});

test('the synthetic context comes from the VM, not from a copy', async (t) => {
  const vmModule = await loadVm(t);
  if (!vmModule) return;
  const { syntheticContext } = require('../src/main/verify-preimage');
  const context = await syntheticContext();

  // The version is part of the preimage, so a drifting copy would look like a
  // broken binding rather than a stale constant.
  assert.strictEqual(context.sourceTXID, '00'.repeat(32));
  assert.strictEqual(context.transactionVersion, 1);
  assert.strictEqual(context.sourceSatoshis, 100000);
});
