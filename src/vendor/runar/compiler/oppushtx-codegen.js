// ---------------------------------------------------------------------------
// runar-compiler/passes/oppushtx-codegen.ts — the OP_PUSH_TX binding
//
// Vendored subset: the Any-S binding assembler and its constants, lines 243-312
// of upstream. The rest of that module is the legacy binding, the ECTracker
// path and the emitter plumbing, none of which this app uses.
//
// Upstream derives CHECK_PREIMAGE_BINDING_HEX by passing a single `raw_bytes`
// op through the compiler's emitMethod. For one raw_bytes op that emitter is an
// identity: it writes the span verbatim and returns its hex. The tail of this
// file does that directly instead of vendoring the 820-line emitter, and
// test/push-tx.test.js pins the result against the app's own constant.
// ---------------------------------------------------------------------------
// Compressed P = d·G for d = 2²⁴⁸·Gx⁻¹ mod n (verified off-chain).
const ANYS_PUBKEY_HEX = '02b405d7f0322a89d0f9f3a98e6f938fdc1c969a8d1382a2bf66a71ae74a1e83b0';
// Curve order n as a 33-byte little-endian script number (0x00 sign byte last).
const N_LE_HEX = '414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00';
// DER: 0x02 0x20 || Gx (r-field, no sign pad) || 0x02 (opening tag of s-field).
const R_DER_S_TAG_HEX = '022079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179802';
const OP = {
    OP_0: 0x00, OP_1: 0x51, OP_2: 0x52, OP_IF: 0x63, OP_ELSE: 0x67, OP_ENDIF: 0x68,
    OP_NIP: 0x77, OP_OVER: 0x78, OP_SWAP: 0x7c, OP_TUCK: 0x7d, OP_CAT: 0x7e,
    OP_SPLIT: 0x7f, OP_NUM2BIN: 0x80, OP_BIN2NUM: 0x81, OP_SIZE: 0x82,
    OP_0NOTEQUAL: 0x92, OP_ADD: 0x93, OP_SUB: 0x94, OP_DIV: 0x96, OP_MOD: 0x97,
    OP_PICK: 0x79, OP_2MUL: 0x8d, OP_MUL: 0x95,
    OP_LESSTHAN: 0x9f, OP_DUP: 0x76, OP_HASH256: 0xaa, OP_CHECKSIGVERIFY: 0xad,
};
/** Assemble the Any-S binding blob (fixed bytes; opcode-level, no emitter). */
function anySBindingBytes(sighashFlag) {
    const b = [];
    const op = (...codes) => b.push(...codes);
    const pushHex = (hex) => {
        const data = hex.match(/../g).map((h) => parseInt(h, 16));
        if (data.length >= 0x4c)
            throw new Error('unexpected long push');
        b.push(data.length, ...data);
    };
    // [preimage] → [preimage, digest]
    op(OP.OP_DUP, OP.OP_HASH256);
    // reverse 32-byte digest: fan out, then cat back (top-down ⇒ reversed)
    for (let i = 0; i < 31; i++)
        op(OP.OP_1, OP.OP_SPLIT);
    for (let i = 0; i < 31; i++)
        op(OP.OP_SWAP, OP.OP_CAT);
    // little-endian digest + 0x00 sign byte → z as a positive script number
    pushHex('00');
    op(OP.OP_CAT, OP.OP_BIN2NUM);
    // s0 = z + 2²⁴⁸  (2²⁴⁸ built as 31 zero bytes ‖ 0x01, interpreted LE)
    op(OP.OP_0);
    pushHex('1f');
    op(OP.OP_NUM2BIN, OP.OP_1, OP.OP_CAT, OP.OP_ADD);
    // s = s0 mod n, then low-S: s' = s + (s > n/2)·(n − 2s)  — BRANCHLESS, like
    // the legacy construction: no OP_IF, so static analyzers (which enumerate
    // execution paths, and must agree on them across tiers) see the same path
    // structure as before. (s>n/2 ⇒ s' = n−s, the standard ECDSA malleation.)
    pushHex(N_LE_HEX);
    op(OP.OP_TUCK, OP.OP_MOD); // [n, s]
    op(OP.OP_OVER, OP.OP_2, OP.OP_DIV); // [n, s, n/2]
    op(OP.OP_OVER, OP.OP_LESSTHAN); // [n, s, hi]
    op(OP.OP_2, OP.OP_PICK, OP.OP_2, OP.OP_PICK); // [n, s, hi, n, s]
    op(OP.OP_2MUL, OP.OP_SUB); // [n, s, hi, n-2s]
    op(OP.OP_MUL, OP.OP_ADD); // [n, s']
    op(OP.OP_NIP); // [s']
    // s (minimal LE script number) → big-endian DER magnitude: fan out one byte
    // while the remainder is a nonzero number (empty splits once exhausted).
    for (let i = 0; i < 31; i++)
        op(OP.OP_DUP, OP.OP_0NOTEQUAL, OP.OP_SPLIT);
    for (let i = 0; i < 31; i++)
        op(OP.OP_SWAP, OP.OP_CAT);
    // sig = 0x30 ‖ totLen ‖ 0x02 0x20 Gx ‖ 0x02 ‖ len(s) ‖ s ‖ flag
    op(OP.OP_SIZE, OP.OP_SWAP, OP.OP_CAT); // len(s) ‖ s
    pushHex(R_DER_S_TAG_HEX);
    op(OP.OP_SWAP, OP.OP_CAT);
    op(OP.OP_SIZE, OP.OP_SWAP, OP.OP_CAT); // totLen ‖ fields
    pushHex('30');
    op(OP.OP_SWAP, OP.OP_CAT);
    pushHex((sighashFlag & 0xff).toString(16).padStart(2, '0'));
    op(OP.OP_CAT);
    // verify against P = d·G; abort unless hash256(preimage) == real tx sighash
    pushHex(ANYS_PUBKEY_HEX);
    op(OP.OP_CHECKSIGVERIFY);
    return new Uint8Array(b);
}

const SIGHASH_FLAG_DEFAULT = 0x41;

/** Hex of the canonical construction (the value the other 6 tiers must pin). */
export const CHECK_PREIMAGE_BINDING_HEX = Array.from(
  anySBindingBytes(SIGHASH_FLAG_DEFAULT), (b) => b.toString(16).padStart(2, '0')).join('');

export { anySBindingBytes };
