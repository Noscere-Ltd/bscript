// Signature checking for checkSig and checkMultiSig.
//
// A signature's last byte is its sighash type, and that type decides which
// message it covers: bit 0x20 selects the original transaction digest
// algorithm, 0x40 without it selects BIP-143. The scope therefore comes from
// the signature itself, never from a guess about the byte's range.
//
// Bit 0x20 is also gated: it is only valid after Chronicle, which @bsv/sdk
// reads from the transaction version, the same switch version 1 already uses
// for the rest of the strict rules.

const { PublicKey, TransactionSignature, Transaction, Script, Hash, BigNumber, ECDSA } = require('@bsv/sdk');

const SIGHASH_CHRONICLE = TransactionSignature.SIGHASH_CHRONICLE; // 0x20

// @bsv/sdk rejects the Chronicle scope on a spend that predates activation, and
// with no explicit verify flags it reads version > 1 as activated. Checking the
// same thing here keeps the app from calling a signature valid that Spend, and
// so a node, would refuse. Without a transaction there is no version to judge
// by, so nothing is rejected.
function isChronicleBeforeActivation(scope, txContext) {
  if ((scope & SIGHASH_CHRONICLE) === 0 || !txContext) return false;
  return Transaction.fromHex(txContext.txHex).version <= 1;
}

// Why Spend would refuse this scope before looking at the signature, or null.
// The base type has to be ALL, NONE or SINGLE, whatever the transaction is.
function scopeError(scope, sighashHex, txContext) {
  const baseType = scope & 0x1f;
  if (baseType < TransactionSignature.SIGHASH_ALL || baseType > TransactionSignature.SIGHASH_SINGLE) {
    return 'The signature hash type is invalid.';
  }
  if (!sighashHex && isChronicleBeforeActivation(scope, txContext)) {
    return 'The signature hash type is invalid before Chronicle.';
  }
  return null;
}

// The sighash is already the message hash, so it is verified as it stands.
// Signature.verify would sha256 it again and check the wrong message.
function verifyAgainstSighash(signature, sighashHex, pubKey) {
  return ECDSA.verify(new BigNumber(sighashHex, 16), signature, pubKey);
}

// The sighash a signature with this scope covers.
function sighashFor({ txHex, inputIndex, prevScriptHex, satoshis, subscriptHex }, scope) {
  const tx = Transaction.fromHex(txHex);
  const input = tx.inputs[inputIndex];

  const params = {
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
  };

  // The original algorithm signs the number one when SIGHASH_SINGLE names an
  // input with no matching output. Nodes kept that bug, and so does Spend.
  if (TransactionSignature.usesOtdaSingleBug(params)) {
    return '01' + '00'.repeat(31);
  }

  const preimage = TransactionSignature.format(params);
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

    const refused = scopeError(signature.scope, sighashHex, txContext);
    if (refused) {
      return { success: false, error: refused };
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
// each one consumes the next matching key. An empty signature keeps its
// place and matches no key, so the check fails, the way it does in Spend.
function verifyMultiSig({ signaturesHex, pubKeysHex, sighashHex, txContext, requireLowS }) {
  try {
    const pubKeys = pubKeysHex.map(hex => PublicKey.fromString(hex));
    const signatures = signaturesHex.map(hex => (hex && hex.length > 0
      ? TransactionSignature.fromChecksigFormat(Array.from(Buffer.from(hex, 'hex')))
      : null));

    let pubKeyIndex = 0;
    let validCount = 0;

    for (const [i, sig] of signatures.entries()) {
      // No key can match an empty signature, so the rest cannot either
      if (!sig) break;
      // Too few keys left for the signatures left: nodes stop here, so a
      // later signature is never looked at
      if (signatures.length - i > pubKeys.length - pubKeyIndex) break;

      if (requireLowS && !sig.hasLowS()) {
        return { success: false, error: 'The signature must have a low S value.' };
      }

      const refused = scopeError(sig.scope, sighashHex, txContext);
      if (refused) {
        return { success: false, error: refused };
      }

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
