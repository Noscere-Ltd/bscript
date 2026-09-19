// ---------------------------------------------------------------------------
// Vendored runar-sdk surface.
//
// Upstream index.js exports the whole SDK — contracts, ANF interpreter, state,
// tokens, ordinals, codegen. Only the deploy, wallet and OP_PUSH_TX names the
// app calls are vendored; see README.md.
// ---------------------------------------------------------------------------
export { LocalSigner } from './signers/local.js';
export { WhatsOnChainProvider } from './providers/woc.js';
export { buildDeployTransaction, selectUtxos, estimateDeployFee } from './deployment.js';
export { buildP2PKHScript, pubkeyToPKH } from './script-utils.js';
export { computeOpPushTx } from './oppushtx.js';
