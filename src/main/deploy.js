// Deploy: fund, sign and broadcast the current script as a locking script.
//
// This spends real coins, and the renderer that asks for it also runs AI
// replies and opened projects, so every refusal is made here as well as in
// the renderer. It lives outside main.js so node can test it with the
// provider stubbed: nothing in the tests reaches the network.

const NETWORKS = ['mainnet', 'testnet'];

// regtest used to be offered and silently went to public testnet
function assertNetwork(network) {
  if (NETWORKS.indexOf(network) === -1) {
    throw new Error('Unknown network "' + network + '". Use mainnet or testnet.');
  }
}

let deploying = false;

// deps: { runar, UnlockingScript, makeProvider }. makeProvider is for tests.
async function deployScript({ wif, scriptHex, satoshis, network }, deps) {
  if (deploying) {
    return { success: false, error: 'A deployment is already in progress.' };
  }
  deploying = true;

  try {
    assertNetwork(network);

    // An empty script compiles from a blank or comment-only editor and would
    // lock the coins in an output with no script at all
    if (typeof scriptHex !== 'string' || !/^([0-9a-fA-F]{2})+$/.test(scriptHex)) {
      return { success: false, error: 'Refusing to deploy: the compiled script is empty or is not hex.' };
    }

    const { LocalSigner, WhatsOnChainProvider, buildDeployTransaction, selectUtxos, buildP2PKHScript } = deps.runar;

    const signer = new LocalSigner(wif, network);
    const address = await signer.getAddress();
    const provider = deps.makeProvider ? deps.makeProvider(network) : new WhatsOnChainProvider(network);

    // Get UTXOs
    const allUtxos = await provider.getUtxos(address);
    if (allUtxos.length === 0) {
      return { success: false, error: 'No UTXOs available. Fund the address first.' };
    }

    // Select UTXOs
    const scriptByteLen = scriptHex.length / 2;
    const selected = selectUtxos(allUtxos, satoshis, scriptByteLen);

    // Build change script
    const changeScript = buildP2PKHScript(address);

    // Build unsigned transaction
    const { tx, inputCount } = buildDeployTransaction(scriptHex, selected, satoshis, address, changeScript);

    // Sign each input
    const txHex = tx.toHex();
    for (let i = 0; i < inputCount; i++) {
      const sigHex = await signer.sign(txHex, i, changeScript, selected[i].satoshis);
      const pubKeyHex = await signer.getPublicKey();

      // Build P2PKH unlocking script: <sig> <pubkey>
      const sigBytes = Buffer.from(sigHex, 'hex');
      const pubBytes = Buffer.from(pubKeyHex, 'hex');

      let unlockHex = '';
      // Push signature
      unlockHex += sigBytes.length.toString(16).padStart(2, '0') + sigHex;
      // Push pubkey
      unlockHex += pubBytes.length.toString(16).padStart(2, '0') + pubKeyHex;

      tx.inputs[i].unlockingScript = deps.UnlockingScript.fromHex(unlockHex);
    }

    // Broadcast
    const txid = await provider.broadcast(tx);

    return { success: true, txid, address };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    deploying = false;
  }
}

module.exports = { deployScript, assertNetwork };
