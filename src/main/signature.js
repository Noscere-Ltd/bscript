// Signature checking for checkSig and checkMultiSig.
//
// A signature's last byte is its sighash type, and that type decides which
// message it covers: bit 0x20 selects the original transaction digest
// algorithm, 0x40 without it selects BIP-143. The scope therefore comes from
// the signature itself, never from a guess about the byte's range.

const { PublicKey, TransactionSignature, Transaction, Script, Hash, BigNumber, ECDSA } = require('@bsv/sdk');

// The sighash is already the message hash, so it is verified as it stands.
// Signature.verify would sha256 it again and check the wrong message.
function verifyAgainstSighash(signature, sighashHex, pubKey) {
  return ECDSA.verify(new BigNumber(sighashHex, 16), signature, pubKey);
}

// The sighash a signature with this scope covers.
function sighashFor({ txHex, inputIndex, prevScriptHex, satoshis, subscriptHex }, scope) {
  const tx = Transaction.fromHex(txHex);
  const input = tx.inputs[inputIndex];

  const preimage = TransactionSignature.format({
    sourceTXID: input.sourceTXID,
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: satoshis,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== inputIndex),
    outputs: tx.outputs,
    inputIndex,
    subscript: Script.fromHex(subscriptHex || prevScriptHex),
    inputSequence: input.sequence,
    lockTime: tx.lockTime,
    scope
  });

  return Buffer.from(Hash.hash256(Buffer.from(preimage))).toString('hex');
}

// Either sighashHex is given, in which case the signature's own scope cannot
// be honoured, or txContext is and the sighash is computed under that scope.
function verifySig({ signatureHex, pubKeyHex, sighashHex, txContext, requireLowS }) {
  try {
    const sigBytes = Array.from(Buffer.from(signatureHex, 'hex'));
    if (sigBytes.length === 0) {
      return { success: true, valid: false };
    }

    const signature = TransactionSignature.fromChecksigFormat(sigBytes);
    if (requireLowS && !signature.hasLowS()) {
      return { success: false, error: 'The signature must have a low S value.' };
    }

    const sighash = sighashHex || sighashFor(txContext, signature.scope);
    const pubKey = PublicKey.fromString(pubKeyHex);

    return {
      success: true,
      valid: verifyAgainstSighash(signature, sighash, pubKey),
      scope: signature.scope
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Each signature carries its own scope, so each is checked against the
// sighash that scope selects. Signatures must match the keys in order, and
// each one consumes the next matching key.
function verifyMultiSig({ signaturesHex, pubKeysHex, sighashHex, txContext, requireLowS }) {
  try {
    const pubKeys = pubKeysHex.map(hex => PublicKey.fromString(hex));
    const signatures = signaturesHex
      .filter(sig => sig && sig.length > 0)
      .map(hex => TransactionSignature.fromChecksigFormat(Array.from(Buffer.from(hex, 'hex'))));

    if (requireLowS && signatures.some(sig => !sig.hasLowS())) {
      return { success: false, error: 'The signature must have a low S value.' };
    }

    let pubKeyIndex = 0;
    let validCount = 0;

    for (const sig of signatures) {
      const sighash = sighashHex || sighashFor(txContext, sig.scope);

      while (pubKeyIndex < pubKeys.length) {
        let isValid = false;
        try {
          isValid = verifyAgainstSighash(sig, sighash, pubKeys[pubKeyIndex]);
        } catch (e) {
          isValid = false;
        }
        pubKeyIndex++;
        if (isValid) {
          validCount++;
          break;
        }
      }
    }

    return { success: true, valid: validCount === signatures.length, validCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { sighashFor, verifySig, verifyMultiSig };
