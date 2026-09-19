# SVSCRIPT Development Guide

For developers extending or modifying SVSCRIPT.

## Setup

```bash
npm install
npm start          # run
npm run dev        # run with DevTools
npm test           # node --test test/*.test.js
```

`@bsv/sdk` is pinned to an exact version and `package-lock.json` is committed.
It is the oracle the test suite checks the interpreter against, and its rules
do change between releases: 2.7.1 added a Chronicle activation gate that made
a previously valid signature invalid. Upgrade it deliberately and read the
diff.

### Rúnar code

`runar-testing` and `runar-sdk` are **not on npm**. The subset the app calls is
vendored under `src/vendor/runar`: the `ScriptVM` behind Verify, the wallet and
broadcast behind Deploy, and `SYNTHETIC_SPEND_CONTEXT`, the spend that Verify
derives a preimage from.

It used to be symlinked into `node_modules` from a local checkout, which meant
`npm install` removed it without a word. `src/vendor/runar/README.md` records
the upstream commit and how to re-sync.

## Project structure

```
bscript/
├── src/
│   ├── main/
│   │   ├── main.js              # Electron main process, IPC handlers
│   │   ├── menu.js              # Application menus
│   │   ├── signature.js         # sighashFor, verifySig, verifyMultiSig
│   │   ├── hash-input.js        # Hash input decoding
│   │   └── verify-preimage.js   # Preimage of the ScriptVM synthetic spend
│   ├── preload/
│   │   └── preload.js           # contextBridge: electronAPI, bsv, runar, ai
│   ├── vendor/runar/            # Vendored Rúnar subset (see its README)
│   ├── shared/                  # Loaded by both processes
│   │   ├── push-data.js         # Minimal push encoding
│   │   └── script-walk.js       # Opcode walker over compiled script bytes
│   └── renderer/
│       ├── index.html           # UI
│       ├── styles.css           # Dark theme
│       ├── boot.js              # Loads renderer scripts in dependency order
│       ├── app.js               # Controller: run, step, verify, settings, AI
│       ├── interpreter.js       # Execution engine, macros, imports
│       ├── compiler.js          # Instructions to hex, and disassembly
│       ├── stack-input.js       # Initial stack parsing
│       ├── verify-plan.js       # What Verify is able to compare
│       ├── push-tx-binding.js   # Vendored checkPreimage binding bytes
│       ├── chain.js             # Chain project model
│       ├── chain-ui.js          # Chain panel
│       ├── escape-html.js
│       ├── syntax.js            # Monaco language definition
│       └── help.md              # In-app help panel content
├── examples/                    # Scripts, libraries, chain projects
├── test/                        # Node test runner suite
└── package.json
```

## Architecture

### Main process (`src/main/`)

Creates the window with context isolation on, node integration off and the
sandbox on, builds the menus, and answers IPC. The handlers fall into groups:

| Group | Handlers |
|---|---|
| Files | `load-file`, `save-file`, `resolve-import-path`, `read-import-file` |
| Hashing | `bsv-sha256`, `bsv-sha1`, `bsv-ripemd160`, `bsv-hash256`, `bsv-hash160` |
| Signatures | `bsv-verify-sig`, `bsv-verify-multisig`, `bsv-compute-sighash` |
| Rúnar | `runar-verify-script`, `runar-verify-preimage`, `runar-get-address`, `runar-get-balance`, `runar-deploy-script`, `runar-compute-preimage` |
| Chain | `open-chain-dialog`, `load-chain-project`, `build-chain-tx` |
| AI | `ai-chat` |

Anything needing `@bsv/sdk` or Rúnar lives here, because the renderer is
sandboxed and has no module loader.

### Preload (`src/preload/preload.js`)

Exposes four namespaces through `contextBridge`: `window.electronAPI` (files,
menus), `window.bsv` (hashing, signatures, sighash), `window.runar` (ScriptVM,
wallet, preimage), `window.ai`.

### Renderer (`src/renderer/`)

There is no module system. Each file defines globals, and `boot.js` loads them
in dependency order:

```
../shared/push-data.js, ../shared/script-walk.js, escape-html.js,
interpreter.js, syntax.js, push-tx-binding.js, stack-input.js,
compiler.js, verify-plan.js, chain.js, chain-ui.js, app.js
```

A new renderer file has to be added to `APP_SCRIPTS` in `boot.js`, or nothing
will load it.

To make a file testable under Node as well, end it with the guard the others
use:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```

### File idiom

Match the file you are editing rather than the repo as a whole.
`interpreter.js`, `app.js` and the `src/main` and `src/shared` files use modern
JavaScript (`const`/`let`, classes, arrow functions). `chain.js`, `chain-ui.js`
and `compiler.js` use `var` and function expressions throughout.

## Execution model

Script numbers are `BigInt`, so arithmetic is arbitrary width, not 32-bit.
`toNumber(value)` returns a `BigInt`; `toIndex(value)` returns an ordinary
number and is what positions, widths and counts use.

`interpreter.txVersion` selects the rules. Version 1 is strict: minimal pushes,
minimal number encoding, low-S signatures, NULLDUMMY, push-only unlocking
scripts and a clean stack. Any version above 1 relaxes all of them, which is
what `isRelaxed()` tests. `checkFinalStack()` applies the end-of-script verdict
after the last instruction, on both the Run and the Step path.

## Adding an opcode

1. **Interpret it.** In `src/renderer/interpreter.js`, add an entry to
   `opcodeMap` in `executeOpcode()` and write the method:

   ```javascript
   'min3': () => this.op_min3(),

   op_min3() {
     const c = this.toNumber(this.popStack());
     const b = this.toNumber(this.popStack());
     const a = this.toNumber(this.popStack());
     const result = [a, b, c].reduce((x, y) => (y < x ? y : x));
     this.pushStack(result);
     this.addHistory('min3', `min(${a}, ${b}, ${c}) = ${result}`);
   }
   ```

   Use `BigInt` comparisons, not `Math.min`, which cannot take a `BigInt`.

2. **Compile it.** Add the name and its byte to `OPCODE_MAP` in
   `src/renderer/compiler.js`, and the reverse mapping in `OPCODE_NAMES` so
   disassembly round-trips.

3. **Highlight it.** Add the name to the `keywords` array in
   `src/renderer/syntax.js`.

4. **Document it.** Add it to `src/renderer/help.md` and the opcode list in
   `readme.md`.

5. **Test it.** Add a case to the matching `test/*.test.js`, and to the corpus
   in `test/differential.js` if `@bsv/sdk` implements the same opcode.

## Adding a macro

Macros expand to base opcodes in `expandMacros()` in `interpreter.js`, before
parsing, and after comments are stripped. The preimage field extractors
(`extractAmount` and friends) are macros, not opcodes. Add the name to
`syntax.js` so it highlights, and test it by calling `expandMacros` directly:
`parse()` calls `reset()`, which clears named imports.

## Testing

```bash
npm test
```

The suite is the Node test runner, no framework. `test/helpers.js` loads the
renderer files into a Node context, wires `window.bsv` to `src/main/signature.js`
and exposes the compiler, so a test can build an interpreter with
`opcodeInterpreter(txVersion)`.

Two parts check against consensus rather than against expectations someone
wrote by hand:

- **`test/differential.test.js`** runs every case in `test/differential.js`
  through both the interpreter and `@bsv/sdk`'s `Spend`, at transaction
  versions 1 and 2, and fails if the two disagree. `@bsv/sdk` is the oracle: if
  they differ, the interpreter is wrong.
- **`test/push-tx.test.js`** validates each shipped covenant through
  `Spend.validate()` and proves it rejects a forged preimage.

When fixing a bug, write the test first and check it goes red by reverting the
fix. A test that passes either way proves nothing.

## Verify

`Verify` compiles the script, then asks `verify-plan.js` what the two engines
can honestly be compared on:

- A script calling `checkPreimage` needs a preimage that matches the spend the
  ScriptVM builds. `verify-preimage.js` derives one from the VM's own
  `SYNTHETIC_SPEND_CONTEXT` and Verify substitutes it for the initial stack.
  The `substitutePreimage` setting turns this off.
- A script checking a signature that the interpreter only simulates cannot be
  compared at all, because the ScriptVM checks it for real. Verify says so
  rather than reporting a mismatch.

`app.js` saves and restores any configured transaction context around the
substitution, so verifying does not discard the user's settings.

## Security

Enabled and not to be turned off: context isolation, sandbox, node integration
disabled, preload `contextBridge`, Content Security Policy.

When adding a feature: reach the file system and the network through IPC, never
directly from the renderer; validate what comes in over IPC; never `eval()` a
user script, the interpreter executes it.

Deploy signs with a WIF the user pastes in and broadcasts to the selected
network. It spends real coins. Keep the key in the renderer only as long as the
operation needs it, and never log it.

## Debugging

```bash
npm run dev     # DevTools open
```

To drive the running app from outside:

```bash
unset ELECTRON_RUN_AS_NODE
npx electron . --remote-debugging-port=9222
```

then talk to it over CDP. Clear a stale instance first:
`pkill -f electron; lsof -ti:9222 | xargs -r kill -9`.

Avoid calling `window.electronAPI.saveFile` with positional arguments from a
console or CDP session: it opens a modal dialog and blocks the connection.

## Common issues

| Symptom | Cause |
|---|---|
| A new renderer file does nothing | Not added to `APP_SCRIPTS` in `boot.js` |
| An opcode runs but will not compile | Missing from `OPCODE_MAP` in `compiler.js` |
| An opcode compiles but is not highlighted | Missing from `keywords` in `syntax.js` |
| Verify reports the VM is unavailable | The preload bridge, or the vendored VM under `src/vendor/runar` |
| A script runs but fails at the end | The version 1 clean stack rule |

## Resources

- [Electron](https://www.electronjs.org/docs)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/docs.html)
- [@bsv/sdk](https://github.com/bitcoin-sv/ts-sdk)
- [BSV Wiki](https://wiki.bitcoinsv.io/)
