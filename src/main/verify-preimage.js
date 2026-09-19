// The preimage that satisfies the OP_PUSH_TX binding inside the Rúnar
// ScriptVM.
//
// The VM takes scripts, not transactions: it builds its own Spend from a fixed
// synthetic one. So a script containing the binding can only pass there if the
// preimage on the stack is the preimage of that synthetic spend. The vendored
// VM exports the context for exactly this, and deriving it from that export
// rather than copying the values is the point: the version is part of the
// preimage, so a copy that drifts would look like a broken binding.

const { TransactionSignature, LockingScript, Hash } = require('@bsv/sdk');

const SIGHASH_ALL_FORKID = 0x41; // the type the binding pins

let _syntheticContext = null;

async function syntheticContext() {
  if (!_syntheticContext) {
    // The VM's own module, which is where the constant lives
    const vm = await import('../vendor/runar/vm/script-vm.js');
    _syntheticContext = vm.SYNTHETIC_SPEND_CONTEXT;
  }
  return _syntheticContext;
}

// The preimage and its digest for a script the ScriptVM is about to run.
async function preimageForScript(scriptHex) {
  const context = await syntheticContext();

  const preimage = Buffer.from(TransactionSignature.format({
    ...context,
    otherInputs: [],
    outputs: [],
    subscript: LockingScript.fromHex(scriptHex),
    scope: SIGHASH_ALL_FORKID
  }));

  return {
    preimageHex: preimage.toString('hex'),
    sighashHex: Buffer.from(Hash.hash256(preimage)).toString('hex')
  };
}

module.exports = { preimageForScript, syntheticContext, SIGHASH_ALL_FORKID };
