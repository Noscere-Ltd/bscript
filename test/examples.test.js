// Every example script, run with the stack its own header documents. This is
// the net that catches an interpreter change quietly altering what the shipped
// examples do.
//
// Each example runs with its own path, so an import resolves relative to the
// example through the disk reader test/helpers.js puts on window.electronAPI.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ScriptInterpreter, narrowAll } = require('./helpers');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const pathOf = (name) => path.join(EXAMPLES, `${name}.bscript`);
const read = (name) => fs.readFileSync(path.join(EXAMPLES, `${name}.bscript`), 'utf8');

// Pull the dummy preimage out of an example's header so the test and the
// documentation cannot drift apart.
const preimageFrom = (name) => read(name).match(/0x02000000[0-9a-f]+/)[0];

// An example that deliberately leaves more than one item on the stack says so
// in its header. Version 1 would reject it on the clean-stack rule.
const versionOf = (name) => {
  const declared = read(name).match(/^\/\/ Transaction version: (\d+)$/m);
  return declared ? Number(declared[1]) : 1;
};

const CASES = [
  { name: 'alt-stack', stack: [], expect: [2450] },
  { name: 'arithmetic', stack: [], expect: [30, 100, 5, 6, 200, 25, 1] },
  { name: 'bitwise', stack: [], expect: ['0x08', '0x0e', '0x06', '0x14', '0x05', '0xfa'] },
  { name: 'conditionals', stack: [], expect: [1100, 51, 999] },
  { name: 'macros', stack: [], expect: [500] },
  { name: 'stack-operations', stack: [], expect: [1, 2, 3, 5, 5, 4, 4, 5, 4, 9] },
  { name: 'multisig-2of3', stack: [0, '0xaa', '0xbb'], expect: [1] },
  {
    name: 'covenant-output-hash',
    stack: () => [preimageFrom('covenant-output-hash')],
    expect: [1]
  },
  {
    name: 'covenant-locktime',
    stack: () => [preimageFrom('covenant-locktime')],
    expect: [1]
  },
  {
    name: 'covenant-rate-limit',
    stack: () => ['0xaa', preimageFrom('covenant-rate-limit')],
    expect: [1]
  },
  {
    name: 'op-push-tx',
    stack: () => [preimageFrom('op-push-tx')],
    expect: [1]
  },
  { name: 'exampleimport', stack: [150], expect: [150, '0x08', '0x0e', '0x06', '0x14', '0x05', '0xfa'] },
  { name: 'import-example', stack: [], expect: [21] },
  { name: 'named-import-example', stack: [], expect: ['0x08'] },
  { name: 'simple-named-import', stack: [], expect: ['0x08'] }
];

for (const { name, stack, expect } of CASES) {
  test(`${name}.bscript runs as documented`, async () => {
    const interp = new ScriptInterpreter();
    interp.txVersion = versionOf(name);
    const initial = typeof stack === 'function' ? stack() : stack;
    const result = await interp.run(read(name), initial, pathOf(name));

    assert.ok(result.success, `${name} failed: ${result.error}`);
    assert.deepStrictEqual(narrowAll(interp.mainStack), expect);
  });
}

// Step parses with the file path and then steps, one past the end for the
// final verdict. It has to land where Run does.
for (const { name, stack, expect } of CASES.filter((c) => /\bimport\b/.test(read(c.name)))) {
  test(`${name}.bscript gives the same result under Step as under Run`, async () => {
    const interp = new ScriptInterpreter();
    interp.txVersion = versionOf(name);
    await interp.parse(read(name), stack, pathOf(name));
    while (interp.ip < interp.instructions.length) await interp.step();
    await interp.step();

    assert.strictEqual(interp.status, 'success', interp.error);
    assert.deepStrictEqual(narrowAll(interp.mainStack), expect);
  });
}

test('an import * body ending in a comment does not swallow the rest of the line', async () => {
  const readImportFile = window.electronAPI.readImportFile;
  window.electronAPI.readImportFile = async () => ({ success: true, content: '2 3 add // five' });
  try {
    const interp = new ScriptInterpreter();
    const result = await interp.run("import * from './lib.bscript' 5 equal", [], pathOf('lib-user'));

    assert.ok(result.success, result.error);
    assert.deepStrictEqual(narrowAll(interp.mainStack), [1]);
  } finally {
    window.electronAPI.readImportFile = readImportFile;
  }
});

test('hash-puzzle.bscript is solved by the secret its header names', async () => {
  const interp = new ScriptInterpreter();
  const result = await interp.run(read('hash-puzzle'), [42]);

  assert.ok(result.success, result.error);
  assert.deepStrictEqual(narrowAll(interp.mainStack), [1]);
});

test('hash-puzzle.bscript rejects a secret that is not 42', async () => {
  const interp = new ScriptInterpreter();
  const result = await interp.run(read('hash-puzzle'), [43]);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /top stack item is false/);
});

test('p2pkh-checksig.bscript rejects a pubkey that is not the one it locks to', async () => {
  const interp = new ScriptInterpreter();
  const result = await interp.run(read('p2pkh-checksig'), ['0xdeadbeef', '0xcafebabe']);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /Verification failed/);
});

test('every example is covered here', () => {
  const covered = new Set([...CASES.map((c) => c.name), 'hash-puzzle', 'p2pkh-checksig']);
  const uncovered = fs.readdirSync(EXAMPLES)
    .filter((f) => f.endsWith('.bscript'))
    .map((f) => f.replace('.bscript', ''))
    .filter((name) => !covered.has(name));

  assert.deepStrictEqual(uncovered, []);
});
