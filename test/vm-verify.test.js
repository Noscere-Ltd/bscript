// F53: the ScriptVM runs under the same transaction version as the simulator.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runInVm } = require('../src/main/vm-verify');
const { ScriptInterpreter, compileInstructionsToHex } = require('./helpers');

const loadVm = () => import('../src/vendor/runar/vm/index.js');

const compile = async (source) =>
  compileInstructionsToHex(await new ScriptInterpreter().parse(source, []));

const local = async (source, txVersion, initialStack = []) => {
  const interp = new ScriptInterpreter();
  interp.txVersion = txVersion;
  return (await interp.run(source, initialStack)).success;
};

test('at version 1 the VM applies the clean-stack rule, at version 2 it does not', async () => {
  const vm = await loadVm();
  const scriptHex = await compile('1 2');

  const strict = runInVm(vm, { scriptHex, initialStackHex: [], txVersion: 1 });
  assert.strictEqual(strict.success, false);
  assert.match(strict.vmError, /clean stack/);
  assert.deepStrictEqual(strict.stack, ['01', '02']);

  const relaxed = runInVm(vm, { scriptHex, initialStackHex: [], txVersion: 2 });
  assert.strictEqual(relaxed.success, true);
});

test('the two engines agree on 1 2 and on arithmetic at both versions', async () => {
  const vm = await loadVm();
  const arithmetic = fs.readFileSync(
    path.join(__dirname, '..', 'examples', 'arithmetic.bscript'), 'utf8');

  for (const source of ['1 2', arithmetic]) {
    const scriptHex = await compile(source);
    for (const txVersion of [1, 2]) {
      assert.strictEqual(
        runInVm(vm, { scriptHex, initialStackHex: [], txVersion }).success,
        await local(source, txVersion),
        `version ${txVersion}`);
    }
  }
});

test('at version 1 the VM applies the strict encoding rules', async () => {
  // A non-minimal push of 5: accepted relaxed, refused strict. The flag has to
  // reach Spend, and the synthetic transaction version must not override it.
  const vm = await loadVm();
  const scriptHex = '010587';

  const strict = runInVm(vm, { scriptHex, initialStackHex: ['05'], txVersion: 1 });
  assert.strictEqual(strict.success, false);
  assert.match(strict.vmError, /minimally/);

  assert.strictEqual(runInVm(vm, { scriptHex, initialStackHex: ['05'], txVersion: 2 }).success, true);
});

test('the initial stack still reaches the VM as the unlocking script', async () => {
  const vm = await loadVm();
  const result = runInVm(vm, { scriptHex: await compile('add 5 equal'), initialStackHex: ['02', '03'], txVersion: 1 });
  assert.strictEqual(result.success, true, result.vmError);
  assert.deepStrictEqual(result.stack, ['01']);
});

// D12: the simulator rejects a second else, so the VM side of Verify must too
test('both engines reject a second else, executed or skipped', async () => {
  const vm = await loadVm();
  for (const source of ['1 if 2 else 3 else 1 endIf', '0 if 1 if 2 else 3 else 4 endIf endIf 1',
    '1 if 1 else 0 endIf']) {
    const scriptHex = await compile(source);
    const result = runInVm(vm, { scriptHex, initialStackHex: [], txVersion: 2 });
    assert.strictEqual(result.success, await local(source, 2), source);
  }
  const twice = runInVm(vm, { scriptHex: await compile('1 if 2 else 3 else 1 endIf'), initialStackHex: [], txVersion: 2 });
  assert.strictEqual(twice.success, false);
  assert.match(twice.vmError, /OP_ELSE/);
});
