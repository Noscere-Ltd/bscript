// ---------------------------------------------------------------------------
// runar-sdk/script-utils.ts — Script utilities
//
// Vendored subset: only the two functions the deploy path uses. Upstream also
// exports extractConstructorArgs and matchesArtifact, which pull in the state
// codec and the ABI encoding table; neither is used here.
// ---------------------------------------------------------------------------
import { Hash, Utils } from '@bsv/sdk';
/**
 * Hash a 66- or 130-char hex secp256k1 public key into its 40-char hex
 * hash160 (RIPEMD160(SHA256(pubkey))). Used as the `changePKH` argument
 * to contract methods and as the input to `buildP2PKHScript`.
 */
export function pubkeyToPKH(pubkeyHex) {
    return Utils.toHex(Hash.hash160(Utils.toArray(pubkeyHex, 'hex')));
}
/**
 * Build a standard P2PKH locking script hex from an address, pubkey hash,
 * or public key.
 *
 *   OP_DUP OP_HASH160 OP_PUSH20 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 *   76      a9         14        <20 bytes>    88              ac
 *
 * Accepted input formats:
 * - 40-char hex: treated as raw 20-byte pubkey hash (hash160)
 * - 66-char hex: compressed public key (auto-hashed via hash160)
 * - 130-char hex: uncompressed public key (auto-hashed via hash160)
 * - Other: decoded as Base58Check P2PKH address (mainnet version 0x00, or
 *   testnet/regtest version 0x6f), payload required to be exactly 20 bytes
 *
 * Round-three audit M-2: the Base58Check branch used to concatenate whatever
 * payload came back, with no length and no version check — @bsv/sdk verifies
 * the checksum, and nothing else. Three measured consequences:
 *
 * - a WIF private key (version 0x80, 33-byte payload) produced a 38-byte
 *   script whose trailing push runs off the end: unparseable, and any change
 *   sent there is permanently unspendable;
 * - an xpub (version 0x0488B21E, 78-byte payload) produced an 82-byte script
 *   with no error raised at all;
 * - a P2SH address (version 0x05 / 0xc4) produced a syntactically PERFECT
 *   25-byte script that is a burn — the payload is a script hash, and only
 *   the version byte says so.
 *
 * All three are reachable from `DeployOptions.changeAddress` /
 * `CallOptions.changeAddress`, which are public caller-supplied fields. Six
 * peer tiers already gate this; Java's `Base58Check.decodeP2PKH` checks both
 * length and version, and is the shape followed here.
 */
export function buildP2PKHScript(addressOrPubKey) {
    let pubKeyHash;
    if (/^[0-9a-fA-F]{40}$/.test(addressOrPubKey)) {
        // Already a raw 20-byte pubkey hash in hex
        pubKeyHash = addressOrPubKey;
    }
    else if (/^[0-9a-fA-F]{66}$/.test(addressOrPubKey) || /^[0-9a-fA-F]{130}$/.test(addressOrPubKey)) {
        // Compressed (33 bytes) or uncompressed (65 bytes) public key — hash it
        pubKeyHash = pubkeyToPKH(addressOrPubKey);
    }
    else {
        // Decode Base58Check address to extract the 20-byte pubkey hash. The
        // checksum is verified by `fromBase58Check` itself (it throws
        // `Invalid checksum`); length and version are checked here (M-2).
        const decoded = Utils.fromBase58Check(addressOrPubKey);
        const dataHex = typeof decoded.data === 'string'
            ? decoded.data
            : Utils.toHex(decoded.data);
        const prefixHex = typeof decoded.prefix === 'string'
            ? decoded.prefix
            : Utils.toHex(decoded.prefix);
        if (dataHex.length !== 40) {
            throw new Error(`buildP2PKHScript: '${addressOrPubKey}' is not a P2PKH address — its Base58Check ` +
                `payload is ${dataHex.length / 2} bytes, expected 20. A WIF private key, an ` +
                'xpub/xprv, or any other Base58Check string is not an address; pass a P2PKH ' +
                'address, a 40-char hash160, or a 66-/130-char public key.');
        }
        if (prefixHex !== '00' && prefixHex !== '6f') {
            throw new Error(`buildP2PKHScript: '${addressOrPubKey}' is not a P2PKH address — Base58Check ` +
                `version byte 0x${prefixHex}, expected 0x00 (mainnet) or 0x6f (testnet/regtest). ` +
                'A P2SH address (0x05 / 0xc4) carries a SCRIPT hash: wrapping it in a P2PKH ' +
                'script produces a well-formed script that burns the output.');
        }
        pubKeyHash = dataHex;
    }
    return '76a914' + pubKeyHash + '88ac';
}
