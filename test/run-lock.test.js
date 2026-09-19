// One run at a time: the lock Run, Step, Verify and Run Transition share.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A fresh copy per test, because the flag is module state
const load = () => new Function(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'run-lock.js'), 'utf8') +
  '\nreturn runExclusive;'
)();

test('a run that starts while another is in flight does nothing', async () => {
  const runExclusive = load();
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const calls = [];

  const first = runExclusive(async () => { calls.push('first'); await gate; return 'done'; });
  const second = await runExclusive(async () => { calls.push('second'); return 'done'; });

  assert.strictEqual(second, undefined);
  open();
  assert.strictEqual(await first, 'done');
  assert.deepStrictEqual(calls, ['first']);
});

test('the lock is released when the run ends, including by throwing', async () => {
  const runExclusive = load();

  await assert.rejects(runExclusive(async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(await runExclusive(async () => 'next'), 'next');
  assert.strictEqual(await runExclusive(() => 'sync is fine too'), 'sync is fine too');
});

test('Run, Step, Verify and Run Transition all go through the lock', () => {
  // ponytail: source-level check, the handlers need the DOM and Monaco
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');
  const app = read('app.js');

  for (const name of ['runScript', 'stepScript', 'verifyScript']) {
    const body = app.match(new RegExp('async function ' + name + '\\(\\) \\{[\\s\\S]*?\\n}'))[0];
    assert.match(body, /await runExclusive\(/, name + ' is not guarded');
  }
  const chain = read('chain-ui.js').match(/async function runChainTransition\(\) \{[\s\S]*?\n}/)[0];
  assert.match(chain, /await runExclusive\(/);

  // run-lock.js has to be loaded before the scripts that call it
  const boot = read('boot.js');
  assert.ok(boot.indexOf("'run-lock.js'") !== -1);
  assert.ok(boot.indexOf("'run-lock.js'") < boot.indexOf("'chain-ui.js'"));
});

test('a full run, a verify and a transition each end a step run', () => {
  // F73: executionMode stayed on stepping, so Step after Verify carried on
  // into an emptied interpreter and the badge kept saying Stepping
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');
  const app = read('app.js');
  const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));

  assert.match(section('async function runScriptNow()', 'async function stepScript()'),
    /executionMode = 'idle';[\s\S]*interpreter\.run\(/);
  assert.match(section('async function verifyScriptNow()', 'function updateUI()'),
    /executionMode = 'idle';\s*const localResult = await interpreter\.run\(/);
});
