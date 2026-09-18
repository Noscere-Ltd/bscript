// Differential harness: run a script through both engines and compare.
//
// The hand-written tests encode expectations I derived from the spec, so a
// misreading of the spec produces a test that agrees with the bug. This
// harness has no such blind spot: the oracle is @bsv/sdk's Spend, an
// independent consensus-following interpreter that is already a dependency.
//
// Both engines are driven to the end of the script and their final stacks are
// normalised to lowercase hex. Spend.validate() is deliberately not used: it
// adds the clean-stack and truthiness rules, which say nothing about whether
// the two engines agree on what the opcodes did.

const fs = require('node:fs');
const path = require('node:path');
const { Spend, LockingScript, UnlockingScript } = require('@bsv/sdk');
const { ScriptInterpreter } = require('./helpers');

// compiler.js is a renderer global script with no exports.
const compileInstructionsToHex = new Function(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'compiler.js'), 'utf8') +
  '\nreturn compileInstructionsToHex;'
)();

const toHex = (bytes) => Buffer.from(bytes).toString('hex');

// Run the script under test/renderer/interpreter.js. Returns the final stack
// as hex, and the token stream, which is what gets compiled for the oracle so
// both engines see the same program after macro expansion.
async function simulate(script, initialStack) {
  const interp = new ScriptInterpreter();
  let result;
  try {
    result = await interp.run(script, initialStack);
  } catch (err) {
    return { ok: false, error: err.message, tokens: interp.instructions };
  }
  return result.success
    ? {
        ok: true,
        stack: interp.mainStack.map((item) => interp.toHexString(item).toLowerCase()),
        tokens: interp.instructions
      }
    : { ok: false, error: result.error, tokens: interp.instructions };
}

// Run the compiled script under @bsv/sdk's Spend. The initial stack goes in
// the unlocking script, which is where a spend actually supplies it.
function reference(lockingHex, unlockingHex) {
  const spend = new Spend({
    sourceTXID: '00'.repeat(32),
    sourceOutputIndex: 0,
    sourceSatoshis: 1,
    lockingScript: LockingScript.fromHex(lockingHex),
    transactionVersion: 1,
    otherInputs: [],
    outputs: [],
    inputIndex: 0,
    unlockingScript: UnlockingScript.fromHex(unlockingHex),
    inputSequence: 0xffffffff,
    lockTime: 0
  });

  try {
    while (spend.step()) {
      if (spend.context === 'LockingScript' &&
          spend.programCounter >= spend.lockingScript.chunks.length) {
        break;
      }
    }
    if (spend.ifStack.length > 0) {
      return { ok: false, error: 'Unclosed conditional' };
    }
    return { ok: true, stack: spend.stack.map(toHex) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Compare the two engines on one script. Returns { agree, sim, ref }.
//
// The engines' error messages are their own wording, so a script both engines
// reject counts as agreement. What matters is that neither accepts a script
// the other rejects, and that accepted scripts leave the same stack.
async function compare(script, initialStack = []) {
  const sim = await simulate(script, initialStack);

  let ref;
  try {
    ref = reference(
      compileInstructionsToHex(sim.tokens),
      compileInstructionsToHex(initialStack.map(String))
    );
  } catch (err) {
    ref = { ok: false, error: `compile failed: ${err.message}` };
  }

  const agree = sim.ok === ref.ok &&
    (!sim.ok || JSON.stringify(sim.stack) === JSON.stringify(ref.stack));

  return { agree, sim, ref };
}

// One line describing a disagreement, for the assertion message.
function explain(script, { sim, ref }) {
  const show = (r) => (r.ok ? JSON.stringify(r.stack) : `error(${r.error.split('\n')[0]})`);
  return `${script}\n  interpreter: ${show(sim)}\n  @bsv/sdk:    ${show(ref)}`;
}

module.exports = { compare, explain, simulate, reference, compileInstructionsToHex };
