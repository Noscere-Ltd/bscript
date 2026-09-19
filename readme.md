# SVSCRIPT - Bitcoin Script Interpreter & Debugger

A desktop application for writing, executing, debugging and verifying Bitcoin SV
Script, with visual stack inspection. Built with Electron and Monaco Editor.

## Features

### Editor & debugging
- **Monaco Editor**: Bitcoin Script syntax highlighting and completion
- **Step-through debugger**: one instruction at a time (F10), with a glyph in the gutter at the current position
- **Error highlighting**: markers in the editor and messages in the console
- **Initial stack input**: space-separated decimal numbers and `0x` hex literals, with a live preview

### Script execution
- **Stack visualisation**: main and alternate stacks, updated as the script runs
- **Execution history**: every executed opcode with a description of what it did
- **87 opcodes**, including the BSV restored set (`cat`, `split`, `mul`, `div`, `mod`, `and`, `or`, `xor`, `invert`, `lShift`, `rShift`, `substr`, `left`, `right`, `2mul`, `2div`)
- **Real hashing**: SHA-256, SHA-1, RIPEMD-160, HASH256, HASH160 through `@bsv/sdk`
- **Transaction version rules**: version 1 applies the strict consensus rules (minimal pushes, minimal number encoding, low-S signatures, NULLDUMMY, clean stack); version 2 and above relax all of them
- **Signatures**: simulated by default, or verified for real against a transaction context you supply

### Verification against a second engine
- **Verify (Cmd/Ctrl + Shift + V)**: compiles the script and runs it through Rúnar's `ScriptVM`, then compares the result with the built-in interpreter
- Scripts that use `checkPreimage` (OP_PUSH_TX) get a preimage derived from the ScriptVM's own synthetic spend, so both engines check the same bytes. Turn this off in Settings to compare without it.
- When a script checks a signature the interpreter only pretends to verify, Verify says so instead of reporting a false mismatch

### Contracts and chains
- **`checkPreimage`**: compiles to the OP_PUSH_TX binding, which ties the preimage
  on the stack to the transaction being signed. In the debugger it is only checked
  when a transaction context is configured; without one it is a no-op and says so
  in the execution history. Verify always checks it for real.
- **Preimage field extractors**: `extractVersion`, `extractHashPrevouts`, `extractHashSequence`, `extractOutpoint`, `extractInputIndex`, `extractAmount`, `extractSequence`, `extractOutputHash`, `extractLocktime`, `extractSigHashType`
- **Chain mode**: load a `.bsm.json` project and step a stateful contract through its methods. The chain panel simulates the transitions; it does not broadcast them.

### Development tools
- **Macros**: `xSwap_n`, `xDrop_n`, `xRot_n`, `hashCat`, `LOOP[n]{body}`
- **Imports**: wildcard, named and `@define` blocks across `.bscript` files
- **Examples**: scripts and importable macro libraries in `examples/`
- **AI assistant**: optional panel that answers Bitcoin Script questions (needs your own API key)
- **Deploy**: fund and broadcast a locking script from a WIF. This spends real coins on the selected network.

### File management
- Native File/Edit/View/Run/Tools/Help menus, recent files, unsaved-work prompts
- File dialogs start in `examples/`, then in the last directory used

### Security
- Context isolation, sandbox, no node integration in the renderer
- All main-process access goes through `contextBridge`

## Installation

```bash
npm install
npm start          # run the app
npm run dev        # run with DevTools
npm test           # run the test suite
```

### Rúnar packages

Verify, Deploy, balance lookups and preimage computation call the Rúnar
packages, which are **not** on npm and are not listed in `package.json`. They are
linked from a local checkout:

```bash
git clone https://github.com/icellan/runar ~/bsv/runar
cd ~/bsv/runar && npm install && npm run build
cd /path/to/bscript
ln -s ~/bsv/runar/packages/runar-testing node_modules/runar-testing
ln -s ~/bsv/runar/packages/runar-sdk     node_modules/runar-sdk
```

Without them the app still runs, steps and executes scripts. Verify reports
`Rúnar ScriptVM not available`, and the tests that need them skip.

## Syntax

SVSCRIPT uses **camelCase** opcode names rather than `OP_` constants:

| Bitcoin Script | SVSCRIPT |
|---|---|
| `OP_DUP OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG` | `dup hash160 equalVerify checkSig` |

## Supported opcodes

### Constants
`false`, `true`, and integer literals. `0` through `16` and `-1` compile to the
single-byte constants; anything else becomes a minimally encoded push.

### Flow control
`nop`, `if`, `notIf`, `else`, `endIf`, `verify`, `return`, `codeSeparator`,
`ver`, `verIf`, `verNotIf`

### Stack
`toAltStack`, `fromAltStack`, `ifDup`, `depth`, `drop`, `dup`, `nip`, `over`,
`pick`, `roll`, `rot`, `swap`, `tuck`, `2drop`, `2dup`, `3dup`, `2over`,
`2rot`, `2swap`

### Arithmetic
`add`, `sub`, `mul`, `div`, `mod`, `negate`, `abs`, `not`, `0notEqual`,
`1add`, `1sub`, `2mul`, `2div`, `min`, `max`, `within`, `booland`, `boolor`

### Bitwise
`and`, `or`, `xor`, `invert`, `lShift`, `rShift`, `lShiftNum`, `rShiftNum`

### Comparison
`equal`, `equalVerify`, `lessThan`, `greaterThan`, `lessThanOrEqual`,
`greaterThanOrEqual`, `numEqual`, `numEqualVerify`, `numNotEqual`

### Byte strings (BSV restored)
`cat`, `split`, `num2bin`, `bin2num`, `size`, `substr`, `left`, `right`

### Cryptographic
`ripemd160`, `sha1`, `sha256`, `hash160`, `hash256`, `checkSig`,
`checkSigVerify`, `checkMultiSig`, `checkMultiSigVerify`, `checkPreimage`

## Usage

### Arithmetic

```javascript
// Push two numbers and add them
5 10 add
// Stack: [15]
```

### Conditionals

```javascript
42
dup 0 greaterThan

if
  100 add
else
  100 sub
endIf

// Stack: [142]
```

### Alternate stack

```javascript
10 20 30

toAltStack
// Main: [10, 20], Alt: [30]

fromAltStack
// Main: [10, 20, 30], Alt: []
```

### A covenant

```javascript
// The preimage is on the stack. checkPreimage ties it to the spend and
// leaves it there, so dup before reading a field out of it.
checkPreimage
dup
extractLocktime
1000 greaterThanOrEqual
verify
drop
true
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Cmd/Ctrl + N | New script |
| Cmd/Ctrl + O | Open script |
| Cmd/Ctrl + S | Save |
| Cmd/Ctrl + Shift + S | Save as |
| Cmd/Ctrl + Enter | Run |
| F10 | Step |
| Cmd/Ctrl + R | Reset execution |
| Cmd/Ctrl + Shift + V | Verify with ScriptVM |
| Cmd/Ctrl + / | Show shortcuts |

## Debugger interface

1. **Initial stack** (left): values pushed before the script runs
2. **Main stack**: the execution stack, top first
3. **Alternate stack**: values moved with `toAltStack`
4. **Execution history**: each executed opcode and what it did
5. **State**: instruction pointer, total instructions, executed count
6. **Console**: logs, errors and results

### Run mode
Executes the whole script, then applies the end-of-script rules for the
selected transaction version: the stack must not be empty, the top item must be
true, and at version 1 exactly one item may remain.

### Step mode
F10 executes one instruction. The same end-of-script rules apply when the last
instruction has run.

## Execution model

- **Stack-based**, LIFO, with a main and an alternate stack
- **Arbitrary-width script numbers**: values are held as `BigInt`, so arithmetic
  is not capped at 32 bits. Positions, widths and counts stay ordinary numbers.
- **No loops**: static branching only. `LOOP[n]{}` unrolls at compile time.
- **Deterministic** and non-Turing-complete

## Settings

- **Signature verification**: simulate `checkSig`, or verify against a supplied
  sighash, raw transaction or preimage
- **Verification**: whether Verify substitutes a matching preimage for
  `checkPreimage` scripts (on by default)
- **Transaction version**: 1 for the strict rules, 2 or above to relax them
- **Network**: mainnet, testnet or regtest, used by Deploy and balance lookups
- **AI assistant**: provider, model and API key

## Project layout

```
bscript/
├── src/
│   ├── main/
│   │   ├── main.js              # Electron main process and IPC handlers
│   │   ├── menu.js              # Application menus
│   │   ├── signature.js         # Sighash, signature and multisig verification
│   │   ├── hash-input.js        # Hash input decoding
│   │   └── verify-preimage.js   # Preimage of the ScriptVM's synthetic spend
│   ├── preload/
│   │   └── preload.js           # contextBridge: electronAPI, bsv, runar, ai
│   ├── shared/
│   │   ├── push-data.js         # Minimal push encoding, used by both processes
│   │   └── script-walk.js       # Steps over a compiled script's opcodes
│   └── renderer/
│       ├── index.html           # UI
│       ├── styles.css           # Dark theme
│       ├── boot.js              # Loads the renderer scripts in order
│       ├── app.js               # Application controller
│       ├── interpreter.js       # Interpreter engine, macros, imports
│       ├── compiler.js          # Instructions to script hex
│       ├── stack-input.js       # Initial stack parsing
│       ├── verify-plan.js       # Decides what Verify can compare
│       ├── push-tx-binding.js   # Vendored checkPreimage binding
│       ├── chain.js             # Chain project model
│       ├── chain-ui.js          # Chain panel
│       ├── escape-html.js
│       ├── syntax.js            # Monaco language definition
│       └── help.md              # In-app help
├── examples/                    # Example scripts, libraries, chain projects
├── test/                        # Node test runner suite
└── package.json
```

## Testing

```bash
npm test
```

The suite covers the opcodes, macros, imports, compiler, chain scripts and the
OP_PUSH_TX binding. Two parts of it check the interpreter against consensus
rather than against hand-written expectations:

- `test/differential.test.js` runs a corpus of scripts through both the
  interpreter and `@bsv/sdk`'s `Spend`, at transaction versions 1 and 2, and
  requires the same answer from each.
- `test/push-tx.test.js` validates every shipped covenant through
  `Spend.validate()`, and proves each one rejects a forged preimage.

## Documentation

| Document | Covers |
|---|---|
| `QUICKSTART.md` | Installing and running your first script |
| `user-guide.md` | Using the application: versions, signatures, Verify, covenants, chain mode, deployment |
| `readme.md` | This file: features and the opcode reference |
| `development.md` | Architecture, adding opcodes, the test suite |
| Help panel | Opcode descriptions, macros and imports, in the app |

## Contributing

See `development.md` for the architecture, how to add an opcode, and how the
tests are organised.

## Credits

- [Electron](https://www.electronjs.org/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [@bsv/sdk](https://github.com/bitcoin-sv/ts-sdk)
- [Rúnar](https://github.com/icellan/runar) - ScriptVM, compiler and the
  `checkPreimage` binding
