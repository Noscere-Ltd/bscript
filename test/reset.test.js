// What reset() clears and what it keeps between runs.

const { test } = require('node:test');
const assert = require('node:assert');
const { ScriptInterpreter } = require('./helpers');

test('reset forgets where the previous run failed', async () => {
  const interp = new ScriptInterpreter();
  await interp.run('1\n2\nbogus');
  assert.strictEqual(interp.errorLine, 2);
  assert.strictEqual(interp.errorInstruction, 'bogus');

  // This one fails at the end of the script, which sets no line of its own
  const result = await interp.run('0');
  assert.strictEqual(result.success, false);
  assert.strictEqual(interp.errorLine, undefined);
  assert.strictEqual(interp.errorInstruction, undefined);
});

test('reset keeps transaction version 0 and defaults an unset one to 1', () => {
  const interp = new ScriptInterpreter();
  assert.strictEqual(interp.txVersion, 1);

  interp.txVersion = 0;
  interp.reset();
  assert.strictEqual(interp.txVersion, 0);
});
