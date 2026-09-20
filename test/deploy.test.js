// Deploy safety. Nothing here reaches the network: the provider is a stub, so
// what is proved is the handler logic and the transaction the builder makes.

const { test } = require('node:test');
const assert = require('node:assert');
const { PrivateKey, UnlockingScript } = require('@bsv/sdk');
const { deployScript, assertNetwork } = require('../src/main/deploy');
const { ScriptInterpreter, compileInstructionsToHex } = require('./helpers');

const loadSdk = () => import('../src/vendor/runar/sdk/index.js');

const KEY = PrivateKey.fromRandom();
const MAINNET_WIF = KEY.toWif();
const TESTNET_WIF = KEY.toWif([0xef]);

// A provider that holds one coin and records what it is asked to do
function stubProvider(log, gate) {
  return {
    getUtxos: async (address) => {
      log.push(['getUtxos', address]);
      if (gate) await gate;
      return [{ txid: 'aa'.repeat(32), outputIndex: 0, satoshis: 50000, script: '' }];
    },
    broadcast: async (tx) => {
      log.push(['broadcast', tx]);
      return 'bb'.repeat(32);
    }
  };
}

async function deps(log, gate) {
  return {
    runar: await loadSdk(),
    UnlockingScript,
    makeProvider: (network) => {
      log.push(['provider', network]);
      return stubProvider(log, gate);
    }
  };
}

test('an empty script is refused before the provider is touched', async () => {
  // F47: a blank or comment-only editor compiles to '', and the old handler
  // built a 1000 sat output with no locking script
  for (const scriptHex of ['', undefined, null, 'zz', '5']) {
    const log = [];
    const result = await deployScript(
      { wif: MAINNET_WIF, scriptHex, satoshis: 1000, network: 'mainnet' }, await deps(log));

    assert.strictEqual(result.success, false);
    assert.match(result.error, /empty or is not hex/);
    assert.deepStrictEqual(log, []);
  }
});

test('a comment-only script compiles to the empty hex the handler refuses', async () => {
  const hex = compileInstructionsToHex(await new ScriptInterpreter().parse('// nothing here\n', []));
  assert.strictEqual(hex, '');
});

test('only mainnet and testnet are networks', async () => {
  // D8: regtest went to public testnet without saying so
  assert.doesNotThrow(() => assertNetwork('mainnet'));
  assert.doesNotThrow(() => assertNetwork('testnet'));
  for (const network of ['regtest', undefined, '', 'main', 'MAINNET']) {
    assert.throws(() => assertNetwork(network), /Unknown network/);

    const log = [];
    const result = await deployScript(
      { wif: MAINNET_WIF, scriptHex: '51', satoshis: 1000, network }, await deps(log));
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Unknown network/);
    assert.deepStrictEqual(log, []);
  }
});

test('a deployment locks the script it was given and is broadcast once', async () => {
  const log = [];
  const result = await deployScript(
    { wif: TESTNET_WIF, scriptHex: '5187', satoshis: 1000, network: 'testnet' }, await deps(log));

  assert.strictEqual(result.success, true, result.error);
  assert.strictEqual(result.txid, 'bb'.repeat(32));
  assert.strictEqual(result.address, KEY.toAddress('testnet'));
  assert.deepStrictEqual(log[0], ['provider', 'testnet']);
  assert.deepStrictEqual(log[1], ['getUtxos', KEY.toAddress('testnet')]);

  const broadcasts = log.filter((entry) => entry[0] === 'broadcast');
  assert.strictEqual(broadcasts.length, 1);
  const tx = broadcasts[0][1];
  assert.strictEqual(tx.outputs[0].lockingScript.toHex(), '5187');
  assert.strictEqual(tx.outputs[0].satoshis, 1000);
  assert.ok(tx.inputs[0].unlockingScript.toHex().length > 0, 'the input is signed');
});

test('a second deployment is refused while the first is in flight', async () => {
  // F57: a double click invoked the broadcast handler twice
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const log = [];
  const d = await deps(log, gate);
  const params = { wif: MAINNET_WIF, scriptHex: '51', satoshis: 1000, network: 'mainnet' };

  const first = deployScript(params, d);
  const second = await deployScript(params, d);
  assert.strictEqual(second.success, false);
  assert.match(second.error, /already in progress/);

  open();
  assert.strictEqual((await first).success, true);
  assert.strictEqual(log.filter((entry) => entry[0] === 'broadcast').length, 1);

  // The flag clears, including after a failure
  assert.strictEqual((await deployScript(params, d)).success, true);
  assert.strictEqual((await deployScript({ ...params, wif: 'nope' }, d)).success, false);
  assert.strictEqual((await deployScript(params, d)).success, true);
});

test('LocalSigner follows the network', async () => {
  // D9, F60: a testnet WIF was rejected and the address was always mainnet
  const { LocalSigner } = await loadSdk();

  assert.strictEqual(await new LocalSigner(MAINNET_WIF).getAddress(), KEY.toAddress());
  assert.strictEqual(await new LocalSigner(MAINNET_WIF, 'mainnet').getAddress(), KEY.toAddress('mainnet'));

  const testnetAddress = await new LocalSigner(TESTNET_WIF, 'testnet').getAddress();
  assert.strictEqual(testnetAddress, KEY.toAddress('testnet'));
  assert.match(testnetAddress, /^[mn]/);

  // A key for the other network is refused rather than quietly used
  assert.throws(() => new LocalSigner(MAINNET_WIF, 'testnet'), /testnet WIF/);
  assert.throws(() => new LocalSigner(TESTNET_WIF, 'mainnet'), /mainnet WIF/);
  assert.throws(() => new LocalSigner(TESTNET_WIF), /mainnet WIF/);
  // F86
  assert.throws(() => new LocalSigner('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'), /uncompressed WIF/);

  // Both networks sign with the same key
  assert.strictEqual(await new LocalSigner(TESTNET_WIF, 'testnet').getPublicKey(),
    await new LocalSigner(MAINNET_WIF).getPublicKey());
});

test('the settings offer mainnet and testnet only, and always show them', () => {
  // ponytail: source-level check of the markup
  const html = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const networks = [...html.matchAll(/name="network" value="(\w+)"/g)].map((m) => m[1]);

  assert.deepStrictEqual(networks, ['mainnet', 'testnet']);
  assert.match(html, /id="network-settings">/);
});

test('a hex literal with a non-hex digit does not compile', async () => {
  // F55: 0x12g4 compiled to 021200 and 0xzz to 0100, and Deploy compiles
  // without running
  const compile = async (source) =>
    compileInstructionsToHex(await new ScriptInterpreter().parse(source, []));

  assert.throws(() => compileInstructionsToHex(['0x12g4']), /12g4/);
  assert.throws(() => compileInstructionsToHex(['0xzz']), /zz/);
  assert.strictEqual(compileInstructionsToHex(['0x12a4']), '0212a4');
  assert.strictEqual(compileInstructionsToHex(['0xABCD']), '02abcd');
  assert.strictEqual(await compile('0x12a4'), '0212a4');
});
