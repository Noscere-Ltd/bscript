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

const { Spend, LockingScript, UnlockingScript } = require('@bsv/sdk');
const { ScriptInterpreter, opcodeInterpreter, compileInstructionsToHex } = require('./helpers');

const toHex = (bytes) => Buffer.from(bytes).toString('hex');

// Run the script under test/renderer/interpreter.js. Returns the final stack
// as hex, and the token stream, which is what gets compiled for the oracle so
// both engines see the same program after macro expansion.
async function simulate(script, initialStack, txVersion = 1) {
  const interp = opcodeInterpreter(txVersion);
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
function makeSpend(lockingHex, unlockingHex, txVersion) {
  return new Spend({
    sourceTXID: '00'.repeat(32),
    sourceOutputIndex: 0,
    sourceSatoshis: 1,
    lockingScript: LockingScript.fromHex(lockingHex),
    transactionVersion: txVersion,
    otherInputs: [],
    outputs: [],
    inputIndex: 0,
    unlockingScript: UnlockingScript.fromHex(unlockingHex),
    inputSequence: 0xffffffff,
    lockTime: 0
  });
}

function reference(lockingHex, unlockingHex, txVersion = 1) {
  const spend = makeSpend(lockingHex, unlockingHex, txVersion);

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

// The verdict Spend.validate() reaches: the same execution, plus the clean
// stack and truthiness rules the harness above leaves out on purpose. Only
// the accept or reject answer is compared, not the wording.
function referenceVerdict(lockingHex, unlockingHex, txVersion = 1) {
  try {
    makeSpend(lockingHex, unlockingHex, txVersion).validate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Same script through interpreter.run(), which applies those rules itself.
async function compareVerdict(script, initialStack = [], txVersion = 1) {
  const interp = new ScriptInterpreter();
  interp.txVersion = txVersion;
  const result = await interp.run(script, initialStack);
  const sim = result.success ? { ok: true } : { ok: false, error: result.error };

  const ref = referenceVerdict(
    compileInstructionsToHex(interp.instructions),
    compileInstructionsToHex(initialStack.map(String)),
    txVersion
  );

  return { agree: sim.ok === ref.ok, sim, ref };
}

// Compare the two engines on one script. Returns { agree, sim, ref }.
//
// The engines' error messages are their own wording, so a script both engines
// reject counts as agreement. What matters is that neither accepts a script
// the other rejects, and that accepted scripts leave the same stack.
async function compare(script, initialStack = [], txVersion = 1) {
  const sim = await simulate(script, initialStack, txVersion);

  let ref;
  try {
    ref = reference(
      compileInstructionsToHex(sim.tokens),
      compileInstructionsToHex(initialStack.map(String)),
      txVersion
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

module.exports = {
  compare, compareVerdict, explain, simulate, reference, referenceVerdict,
  compileInstructionsToHex
};
