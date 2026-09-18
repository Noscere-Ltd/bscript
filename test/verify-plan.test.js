// What Verify decides to do with a script before it compares anything.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CHECK_PREIMAGE_BINDING_HEX } = require('../src/renderer/push-tx-binding');

const SRC = path.join(__dirname, '..', 'src');
const { planVerification } = new Function(
  fs.readFileSync(path.join(SRC, 'shared', 'script-walk.js'), 'utf8') +
  fs.readFileSync(path.join(SRC, 'renderer', 'verify-plan.js'), 'utf8') +
  '\nreturn { planVerification };'
)();

const plan = (scriptHex, options = {}) =>
  planVerification(scriptHex, { bindingHex: CHECK_PREIMAGE_BINDING_HEX, ...options });

test('an ordinary script is compared with nothing substituted', () => {
  assert.deepStrictEqual(plan('5193559c'),
    { substitutePreimage: false, compare: true, reason: null });
});

test('a script with the binding gets a preimage substituted', () => {
  const result = plan('51' + CHECK_PREIMAGE_BINDING_HEX + '75');
  assert.strictEqual(result.substitutePreimage, true);
  assert.strictEqual(result.compare, true);
});

test('with substitution off, a binding script is not compared', () => {
  const result = plan(CHECK_PREIMAGE_BINDING_HEX, { substitutePreimage: false });
  assert.strictEqual(result.compare, false);
  assert.strictEqual(result.substitutePreimage, false);
  assert.match(result.reason, /OP_PUSH_TX binding/);
});

test('a simulated signature check is never compared', () => {
  // The simulator answers true for any non-empty signature, the ScriptVM does
  // real ECDSA, so the two can only disagree.
  for (const opcode of ['ac', 'ad', 'ae', 'af']) {
    const result = plan('5151' + opcode);
    assert.strictEqual(result.compare, false, `opcode 0x${opcode}`);
    assert.match(result.reason, /only pretends/);
  }
});

test('real signature verification is compared', () => {
  const result = plan('5151ac', { enableSignatures: true });
  assert.strictEqual(result.compare, true);
});

test("the binding's own OP_CHECKSIGVERIFY is not a simulated signature check", () => {
  // The binding ends in OP_CHECKSIGVERIFY against a key it derives itself, so
  // scanning the raw script would refuse every covenant.
  assert.match(CHECK_PREIMAGE_BINDING_HEX, /ad$/);
  const result = plan(CHECK_PREIMAGE_BINDING_HEX);
  assert.strictEqual(result.compare, true);
  assert.strictEqual(result.substitutePreimage, true);
});

test('a signature opcode inside push data is data, not a check', () => {
  // 0xac here is pushed, not executed
  assert.strictEqual(plan('01ac').compare, true);
});
