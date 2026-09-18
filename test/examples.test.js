// Every example script that does not use imports, run with the stack its own
// header documents. This is the net that catches an interpreter change quietly
// altering what the shipped examples do.
//
// Examples using `import` are left out: resolving an import goes through
// window.electronAPI, which only exists inside the app.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ScriptInterpreter } = require('./helpers');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const read = (name) => fs.readFileSync(path.join(EXAMPLES, `${name}.bscript`), 'utf8');

// Pull the dummy preimage out of an example's header so the test and the
// documentation cannot drift apart.
const preimageFrom = (name) => read(name).match(/0x02000000[0-9a-f]+/)[0];

const CASES = [
  { name: 'alt-stack', stack: [], expect: [2450] },
  { name: 'arithmetic', stack: [], expect: [30, 100, 5, 6, 200, 25, 1] },
  { name: 'bitwise', stack: [], expect: ['0x08', '0x0e', '0x06', '0x14', '0x05', '0xfa'] },
  { name: 'conditionals', stack: [], expect: [1100, 51, 999] },
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
  }
];

for (const { name, stack, expect } of CASES) {
  test(`${name}.bscript runs as documented`, async () => {
    const interp = new ScriptInterpreter();
    const initial = typeof stack === 'function' ? stack() : stack;
    const result = await interp.run(read(name), initial);

    assert.ok(result.success, `${name} failed: ${result.error}`);
    assert.deepStrictEqual(interp.mainStack, expect);
  });
}

test('hash-puzzle.bscript compares the secret against a hash of its own hash', async () => {
  // The example pushes `dup sha256` where a real contract would push a literal
  // expected hash, so the comparison is always false. Documented here so the
  // example and the interpreter cannot drift apart unnoticed.
  const interp = new ScriptInterpreter();
  const result = await interp.run(read('hash-puzzle'), [42]);

  assert.ok(result.success, result.error);
  assert.deepStrictEqual(interp.mainStack, [42, 0]);
});

test('p2pkh-checksig.bscript rejects a pubkey that is not the one it locks to', async () => {
  const interp = new ScriptInterpreter();
  const result = await interp.run(read('p2pkh-checksig'), ['0xdeadbeef', '0xcafebabe']);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /Verification failed/);
});

test('every example without imports is covered here', () => {
  const covered = new Set([...CASES.map((c) => c.name), 'hash-puzzle', 'p2pkh-checksig']);
  const uncovered = fs.readdirSync(EXAMPLES)
    .filter((f) => f.endsWith('.bscript'))
    .map((f) => f.replace('.bscript', ''))
    .filter((name) => !covered.has(name))
    .filter((name) => !/\bimport\b/.test(read(name)));

  // macros.bscript uses a quoted string literal, which the tokeniser does not
  // support. Left uncovered deliberately.
  assert.deepStrictEqual(uncovered, ['macros']);
});
