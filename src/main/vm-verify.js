// Running a script through the Rúnar ScriptVM for Verify.
//
// The simulator judges a script under the rules of the transaction version in
// Settings: version 1 is strict (minimal encoding, clean stack), anything
// later is relaxed. The VM used to run relaxed whatever the setting, so at
// version 1 `1 2` failed locally on the clean-stack rule, passed in the VM,
// and Verify called that a MISMATCH. The VM now runs under the same version.

const { pushDataHex } = require('../shared/push-data');

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
