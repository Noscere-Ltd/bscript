// Regression tests for the stack chain mode hands to the interpreter.
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'renderer');

const PREIMAGE_HEX = '0200000' + '0'.repeat(9);
const SIG_HEX = '3045022100ff';

// chain-ui.js is a renderer script with no exports. Load it with stubs for the
// globals it reaches for, and hand back the functions under test.
function loadChainUi({ params = [], paramValues = {} } = {}) {
  const src = fs.readFileSync(path.join(SRC, 'chain-ui.js'), 'utf8');

  const method = { name: 'increment', params, terminal: false };
  const engine = {
    project: { name: 'Counter', stateFields: [{ name: 'count', type: 'int' }], methods: [method] },
    currentState: { count: 0 },
    currentUtxo: { txid: 'ab'.repeat(32), vout: 0, satoshis: 10000, lockingScript: '51' },
    stepCount: 0,
    getMethod: () => method,
    prepareTransition: () => ({
      prevUtxo: engine.currentUtxo,
      newLockingScript: '51',
      newSatoshis: 9000,
      codeSeparatorIndex: 0
    })
  };

  const elements = {
    'chain-method-select': { value: 'increment' },
    'chain-new-state-input': { value: '{"count":1}' }
  };

  const document = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => params.map((p) => ({ dataset: { param: p.name }, value: paramValues[p.name] || '' }))
  };

  const window = {
    electronAPI: {
      buildChainTx: async () => ({ success: true, txid: 'cd'.repeat(32), txHex: '00' })
    },
    runar: {
      computePreimage: async () => ({ success: true, preimageHex: PREIMAGE_HEX, sigHex: SIG_HEX })
    }
  };

  const factory = new Function(
    'ChainEngine', 'document', 'window', 'logToConsole', 'editor', 'interpreter', 'updateUI',
    `${src}\nreturn { prepareChainRun, collectNewState };`
  );

  return factory(
    function ChainEngine() { return engine; },
    document,
    window,
    () => {},
    { getValue: () => '', setValue: () => {} },
    { run: async () => ({ success: true }), reset: () => {} },
    () => {}
  );
}

test('chain mode puts the signature above the preimage', async () => {
  // Regression: checkPreimage expands to `codeSeparator <G> checkSigVerify`,
  // which pops the pubkey then the signature. Pushing them the other way round
  // made checkSigVerify consume the preimage the extractors need.
  const { prepareChainRun } = loadChainUi();
  const run = await prepareChainRun();

  assert.deepStrictEqual(run.initialStack, ['0x' + PREIMAGE_HEX, '0x' + SIG_HEX]);
  assert.strictEqual(run.txid, 'cd'.repeat(32));
  assert.deepStrictEqual(run.newState, { count: 1 });
});

test('method parameters sit below the preimage and signature', async () => {
  const { prepareChainRun } = loadChainUi({
    params: [{ name: 'amount', type: 'int' }, { name: 'tag', type: 'bytes' }],
    paramValues: { amount: '42', tag: '0xbeef' }
  });
  const run = await prepareChainRun();

  assert.deepStrictEqual(run.initialStack, [42, '0xbeef', '0x' + PREIMAGE_HEX, '0x' + SIG_HEX]);
});

test('prepareChainRun reports failure instead of returning a partial stack', async () => {
  const src = fs.readFileSync(path.join(SRC, 'chain-ui.js'), 'utf8');
  const { prepareChainRun } = new Function(
    'ChainEngine', 'document', 'window', 'logToConsole', 'editor', 'interpreter', 'updateUI',
    `${src}\nreturn { prepareChainRun };`
  )(
    function ChainEngine() { return { project: null }; },
    { getElementById: () => null, querySelectorAll: () => [] },
    {},
    () => {},
    {},
    {},
    () => {}
  );

  assert.strictEqual(await prepareChainRun(), null);
});

test('Run and Step take their stack from chain mode when it is active', () => {
  // ponytail: source-level check. The wiring itself needs the DOM, Monaco and
  // the main process, so assert the call sites rather than stand all that up.
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');

  const resolver = app.match(/async function resolveInitialStack\(\)[\s\S]*?\n}/);
  assert.ok(resolver, 'resolveInitialStack() is missing');
  assert.match(resolver[0], /chainModeActive/);
  assert.match(resolver[0], /prepareChainRun\(\)/);
  assert.match(resolver[0], /getInitialStackValues\(\)/);

  const callSites = app.match(/await resolveInitialStack\(\)/g) || [];
  assert.strictEqual(callSites.length, 2, 'both runScript() and stepScript() should resolve the stack');
});
