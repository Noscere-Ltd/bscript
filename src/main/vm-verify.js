// Running a script through the Rúnar ScriptVM for Verify.
//
// The simulator judges a script under the rules of the transaction version in
// Settings: version 1 is strict (minimal encoding, clean stack), anything
// later is relaxed. The VM used to run relaxed whatever the setting, so at
// version 1 `1 2` failed locally on the clean-stack rule, passed in the VM,
// and Verify called that a MISMATCH. The VM now runs under the same version.

const { pushDataHex } = require('../shared/push-data');
const { forEachOpcode } = require('../shared/script-walk');

// Since Genesis a node allows one OP_ELSE per OP_IF, in skipped branches as
// well, so the opcodes alone decide it. Spend applies the rule only under
// explicit Genesis flags, which the VM does not pass.
function hasSecondElse(bytes) {
  const elseUsed = [];
  let found = false;
  forEachOpcode(bytes, (op) => {
    if (op >= 0x63 && op <= 0x66) elseUsed.push(false); // IF, NOTIF, VERIF, VERNOTIF
    else if (op === 0x68) elseUsed.pop();               // ENDIF
    else if (op === 0x67 && elseUsed.length > 0) {      // ELSE
      if (elseUsed[elseUsed.length - 1]) found = true;
      elseUsed[elseUsed.length - 1] = true;
    }
  });
  return found;
}

// vmModule is the vendored vm/index.js, passed in because it is ESM.
function runInVm(vmModule, { scriptHex, initialStackHex, txVersion }) {
  const { ScriptVM, hexToBytes, bytesToHex } = vmModule;
  const strict = txVersion === 1;

  // Build unlocking script from initial stack values (push each as data)
  let unlockingHex = '';
  for (const itemHex of initialStackHex || []) {
    unlockingHex += pushDataHex(itemHex || '');
  }

  // The VM's synthetic transaction is version 1, so this flag alone decides
  // whether @bsv/sdk's Spend applies the strict encoding rules
  const vm = new ScriptVM({ flags: { strictEncoding: strict } });
  const result = unlockingHex
    ? vm.execute(hexToBytes(unlockingHex), hexToBytes(scriptHex))
    : vm.executeHex(scriptHex);

  let success = result.success;
  let vmError = result.error || null;

  // The VM steps the script and never calls Spend.validate(), which is where
  // the clean-stack rule lives, so the flag does not bring that rule with it
  if (strict && success && result.stack.length !== 1) {
    success = false;
    vmError = result.stack.length + ' items left on the stack, and version 1 ' +
      'requires exactly one (clean stack)';
  }

  if (success && hasSecondElse(hexToBytes(scriptHex))) {
    success = false;
    vmError = 'OP_ELSE may only be used once for each OP_IF or OP_NOTIF after Genesis.';
  }

  return {
    success: success,
    stack: result.stack.map(bytes => bytesToHex(bytes)),
    altStack: result.altStack.map(bytes => bytesToHex(bytes)),
    vmError: vmError,
    opsExecuted: result.opsExecuted,
    maxStackDepth: result.maxStackDepth
  };
}

module.exports = { runInVm };
