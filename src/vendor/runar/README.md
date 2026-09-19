# Vendored Rúnar code

The subset of [Rúnar](https://github.com/icellan/runar) that SVSCRIPT calls,
copied from its built `dist/` output. MIT licensed; see `LICENSE`.

Source: `runar-testing`, `runar-sdk`, `runar-ir-schema` and `runar-compiler` at
commit `d207ee8e`.

These packages are not published to npm. They used to be symlinked into
`node_modules` from a local checkout, which meant `npm install` silently
removed them and a fresh checkout could not run Verify or Deploy at all.

## What is here

| Path | From | Used by |
| --- | --- | --- |
| `vm/` | `runar-testing/dist/vm/` | Verify: `ScriptVM`, `SYNTHETIC_SPEND_CONTEXT` |
| `ir-schema/input-limits.js` | `runar-ir-schema/dist/` | `InputLimits`, `CanonicalJsonError` |
| `sdk/signers/local.js` | `runar-sdk/dist/signers/` | Deploy: `LocalSigner` |
| `sdk/providers/woc.js` | `runar-sdk/dist/providers/` | Balance lookups: `WhatsOnChainProvider` |
| `sdk/deployment.js` | `runar-sdk/dist/` | Deploy: `buildDeployTransaction`, `selectUtxos` |
| `sdk/oppushtx.js` | `runar-sdk/dist/` | Preimage computation: `computeOpPushTx` |
| `sdk/errors.js` | `runar-sdk/dist/` | `assertScriptHexUnderLimit`, used by the provider |
| `sdk/script-utils.js` | `runar-sdk/dist/` | Deploy: `buildP2PKHScript` |
| `compiler/oppushtx-codegen.js` | `runar-compiler/dist/passes/` | Pins the app's `CHECK_PREIMAGE_BINDING_HEX` |

Files are byte-for-byte copies of upstream except for the changes listed
here, so `diff -r` against a runar checkout still reads cleanly:

1. Bare `runar-ir-schema` imports are rewritten to relative paths.
2. `sdk/script-utils.js` keeps only `buildP2PKHScript` and `pubkeyToPKH`. The
   other exports pull in the state codec and the ABI encoding table, neither of
   which this app uses.
3. `compiler/oppushtx-codegen.js` keeps only the Any-S binding assembler and its
   constants. Upstream derives `CHECK_PREIMAGE_BINDING_HEX` by passing a single
   `raw_bytes` op through the compiler's `emitMethod`, which for one such op
   writes the span verbatim and returns its hex; the vendored file does that
   directly rather than carrying the 820-line emitter, and the result is
   byte-identical to upstream's constant.
4. `sdk/signers/local.js`: `LocalSigner` takes a second argument, the network
   (`mainnet` by default, or `testnet`). Upstream rejects a testnet WIF and
   always returns a mainnet-format address, which WhatsOnChain testnet answers
   with a 400. A testnet signer accepts a WIF that starts with `c` and returns
   a testnet address, and a WIF for the other network is refused.
   Uncompressed `5...` WIFs are still refused by `@bsv/sdk` (`Invalid WIF
   length`), as upstream.

`sdk/index.js` and `package.json` are ours, not upstream. The `package.json`
exists only to mark this directory as ESM inside a CommonJS project.

## Script semantics live in @bsv/sdk, not here

`vm/script-vm.js` reimplements no opcode. It builds a synthetic single-input
transaction context, drives `@bsv/sdk`'s `Spend.step()` one opcode at a time,
and applies the harness DoS bounds. Every opcode semantic, and real ECDSA for
`OP_CHECKSIG`, comes from `@bsv/sdk` — which is a pinned dependency in
`package.json`.

So Verify still compares two independent engines: the built-in interpreter in
`src/main`, and `@bsv/sdk`'s `Spend`. This directory is the adapter that lets a
bare script run through the second one.

## Re-syncing

```bash
git clone https://github.com/icellan/runar /tmp/runar
cd /tmp/runar && npm install && npm run build
diff -r /tmp/runar/packages/runar-testing/dist/vm  src/vendor/runar/vm
```

Expect the two rewritten imports and the `script-utils.js` subset to differ.
Anything else is upstream drift worth reading before copying over.
