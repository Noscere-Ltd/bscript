// The counter chain example, run the way the chain panel runs it, and the
// same spend through @bsv/sdk's Spend as the oracle.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Transaction, LockingScript, UnlockingScript, Spend } = require('@bsv/sdk');
const { ScriptInterpreter } = require('./helpers');
const { pushDataHex } = require('../src/shared/push-data');

const SRC = path.join(__dirname, '..', 'src', 'renderer');
const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const ChainEngine = new Function(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'push-data.js'), 'utf8') +
  fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'script-walk.js'), 'utf8') +
  read('push-tx-binding.js') + read('compiler.js') + read('chain.js') +
  '\nreturn ChainEngine;'
)();
globalThis.ScriptInterpreter = ScriptInterpreter;

const DIR = path.join(__dirname, '..', 'examples', 'counter-chain');
const CONTRACT_PATH = path.join(DIR, 'counter.bscript');
const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
const project = JSON.parse(fs.readFileSync(path.join(DIR, 'counter.bsm.json'), 'utf8'));

async function engineAt(count) {
  const e = new ChainEngine();
  await e.loadProject({ ...project, initialState: { count } }, { [project.contract]: contract }, CONTRACT_PATH);
  return e;
}

// One transition from `from` to `to`: our interpreter's verdict and Spend's
async function transition(from, to, version = 1) {
  const e = await engineAt(from);
  const prep = e.prepareTransition('increment', {}, { count: to });

  const tx = new Transaction(version);
  tx.addInput({ sourceTXID: prep.prevUtxo.txid, sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript(), sequence: 0xffffffff });
  tx.addOutput({ satoshis: prep.newSatoshis, lockingScript: LockingScript.fromHex(prep.newLockingScript) });

  const { computeOpPushTx } = await import('../src/vendor/runar/sdk/index.js');
  const { preimageHex } = computeOpPushTx(tx.toHex(), 0, prep.prevUtxo.lockingScript, prep.prevUtxo.satoshis, undefined);

  const interp = new ScriptInterpreter();
  interp.txVersion = version;
  interp.setTransactionContext({ txHex: tx.toHex(), inputIndex: 0,
    prevScriptHex: prep.prevUtxo.lockingScript, satoshis: prep.prevUtxo.satoshis });
  const ours = await interp.run(contract, ['0x' + preimageHex], CONTRACT_PATH);

  let spendOk;
  try {
    spendOk = new Spend({
      sourceTXID: prep.prevUtxo.txid, sourceOutputIndex: 0, sourceSatoshis: prep.prevUtxo.satoshis,
      lockingScript: LockingScript.fromHex(prep.prevUtxo.lockingScript),
      transactionVersion: version, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: UnlockingScript.fromHex(pushDataHex(preimageHex)),
      inputSequence: 0xffffffff, lockTime: 0
    }).validate();
  } catch (err) {
    spendOk = false;
  }
  return { ours: ours.success, spend: spendOk, error: ours.error };
}

test('the code length in counter.bscript matches the compiled contract', async () => {
  const e = await engineAt(0);
  const written = Number(contract.match(/^(\d+) split$/m)[1]);
  assert.strictEqual(written, e.contractHex.length / 2 + 1,
    'counter.bscript: set the number before "split" to ' + (e.contractHex.length / 2 + 1));
});

test('the counter moves by one in either direction, across every push form', async () => {
  // OP_0, OP_1..OP_16, OP_1NEGATE, one-byte and two-byte numbers
  for (const [from, to] of [[0, 1], [1, 0], [0, -1], [-1, 0], [-1, -2], [16, 17], [17, 16], [127, 128], [128, 127], [-128, -127]]) {
    const r = await transition(from, to);
    assert.deepStrictEqual({ ours: r.ours, spend: r.spend }, { ours: true, spend: true }, `${from} to ${to}: ${r.error}`);
  }
  const v2 = await transition(0, 1, 2);
  assert.deepStrictEqual({ ours: v2.ours, spend: v2.spend }, { ours: true, spend: true }, v2.error);
});

test('any other new count is refused, by us and by @bsv/sdk', async () => {
  for (const [from, to] of [[0, 0], [0, 2], [5, 5], [5, 7], [16, 18], [-1, 1]]) {
    const r = await transition(from, to);
    assert.deepStrictEqual({ ours: r.ours, spend: r.spend }, { ours: false, spend: false }, `${from} to ${to}`);
  }
});
