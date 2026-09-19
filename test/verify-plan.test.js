// What Verify decides to do with a script before it compares anything.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CHECK_PREIMAGE_BINDING_HEX } = require('../src/renderer/push-tx-binding');

const SRC = path.join(__dirname, '..', 'src');
const { planVerification, verifyVerdict } = new Function(
  fs.readFileSync(path.join(SRC, 'shared', 'script-walk.js'), 'utf8') +
  fs.readFileSync(path.join(SRC, 'renderer', 'verify-plan.js'), 'utf8') +
  '\nreturn { planVerification, verifyVerdict };'
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

// F54: the verdict table

const ok = (...stackHex) => ({ success: true, error: null, stackHex });
const failed = (error) => ({ success: false, error, stackHex: [] });

test('both succeed with the same final stack: MATCH', () => {
  assert.strictEqual(verifyVerdict(ok('01'), ok('01')).verdict, 'MATCH');
  assert.strictEqual(verifyVerdict(ok(), ok()).verdict, 'MATCH');
  // hex case is not a difference
  assert.strictEqual(verifyVerdict(ok('AB', '01'), ok('ab', '01')).verdict, 'MATCH');
});

test('both succeed with different final stacks: MISMATCH', () => {
  // Success flags alone called this a MATCH
  const outcome = verifyVerdict(ok('02', '01'), ok('03', '01'));
  assert.strictEqual(outcome.verdict, 'MISMATCH');
  assert.match(outcome.message, /02 01/);
  assert.match(outcome.message, /03 01/);

  assert.strictEqual(verifyVerdict(ok('01'), ok('01', '01')).verdict, 'MISMATCH');
  // ['0101'] and ['01', '01'] are different stacks
  assert.strictEqual(verifyVerdict(ok('0101'), ok('01', '01')).verdict, 'MISMATCH');
});

test('both fail: reported as both failed with both reasons, never MATCH', () => {
  const outcome = verifyVerdict(failed('Unknown opcode'), failed('OP_VERIFY failed'));
  assert.strictEqual(outcome.verdict, 'BOTH_FAILED');
  assert.doesNotMatch(outcome.message, /MATCH/);
  assert.match(outcome.message, /Unknown opcode/);
  assert.match(outcome.message, /OP_VERIFY failed/);
});

test('one succeeds and the other fails: MISMATCH with the failing reason', () => {
  const localOnly = verifyVerdict(ok('01'), failed('clean stack'));
  assert.strictEqual(localOnly.verdict, 'MISMATCH');
  assert.match(localOnly.message, /ScriptVM fails: clean stack/);

  const vmOnly = verifyVerdict(failed('stack is empty'), ok('01'));
  assert.strictEqual(vmOnly.verdict, 'MISMATCH');
  assert.match(vmOnly.message, /local fails: stack is empty/);
});

test('a script that does not compile is reported and nothing is compared', () => {
  // ponytail: source-level check, verifyScript needs the DOM and the bridge
  const app = fs.readFileSync(path.join(SRC, 'renderer', 'app.js'), 'utf8');
  const verify = app.slice(app.indexOf('async function verifyScriptNow()'), app.indexOf('function updateUI()'));

  assert.match(verify, /catch \(error\) \{\s*logToConsole\(`The script does not compile, so nothing was compared/);
  assert.match(verify, /verifyVerdict\(/);
  assert.match(verify, /window\.runar\.verifyScript\(scriptHex, initialStackHex, settings\.txVersion\)/);
});
