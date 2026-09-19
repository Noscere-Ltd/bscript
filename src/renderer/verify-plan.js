// What Verify can honestly do with a given script.
//
// Verify runs a script through the simulator and through the Rúnar ScriptVM
// and compares the verdicts. Two kinds of script make that comparison
// meaningless unless something is done about them first:
//
//   - one containing the OP_PUSH_TX binding, which the VM executes for real.
//     A dummy preimage fails there at OP_CHECKSIGVERIFY while the simulator
//     waves it through, so the engines disagree for a reason that says nothing
//     about either. Substituting the preimage of the VM's own spend makes both
//     check the same thing.
//   - one whose signatures the simulator is only pretending to check, while
//     the VM does real ECDSA. Nothing can be substituted for a signature the
//     script does not carry, so the comparison is skipped and said so.

var CHECKSIG_OPCODES = [0xac, 0xad, 0xae, 0xaf];

// Returns { substitutePreimage, compare, reason }.
function planVerification(scriptHex, options) {
  var bindingHex = options.bindingHex;
  var substituteAllowed = options.substitutePreimage !== false;
  var signaturesReal = options.enableSignatures === true;

  var hasBinding = bindingHex ? scriptHex.indexOf(bindingHex) !== -1 : false;

  // The binding contains an OP_CHECKSIGVERIFY of its own, and that one is not
  // a simulated signature check, so it comes out before the script is scanned.
  var withoutBinding = hasBinding ? scriptHex.split(bindingHex).join('') : scriptHex;
  var bytes = [];
  for (var i = 0; i + 1 < withoutBinding.length; i += 2) {
    bytes.push(parseInt(withoutBinding.substr(i, 2), 16));
  }
  var hasSimulatedSignature = !signaturesReal && usesOpcode(bytes, CHECKSIG_OPCODES);

  if (hasSimulatedSignature) {
    return {
      substitutePreimage: false,
      compare: false,
      reason: 'this script checks a signature that the simulator only pretends ' +
        'to verify, while the ScriptVM checks it for real'
    };
  }

  if (hasBinding && !substituteAllowed) {
    return {
      substitutePreimage: false,
      compare: false,
      reason: 'this script contains the OP_PUSH_TX binding, which the ScriptVM ' +
        'executes against its own transaction. Turn on preimage substitution in ' +
        'Settings to compare the two engines on a preimage they both accept'
    };
  }

  return { substitutePreimage: hasBinding, compare: true, reason: null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { planVerification };
}
