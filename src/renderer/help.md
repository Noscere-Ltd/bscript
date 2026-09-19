# SVSCRIPT Help

## Quick Start

SVSCRIPT is a Bitcoin Script interpreter and debugger. Write scripts using **camelCase** opcodes (e.g., `dup`, `add`, `checkSig` instead of `OP_DUP`, `OP_ADD`, `OP_CHECKSIG`).

## Import System

Import code from other `.bscript` files for modular script development.

### Wildcard Import
Inlines all content from a file immediately:

```javascript
import * from './libs/common-macros.bscript'
```

### Named Import
Import code with a name and use it like a macro/function call:

```javascript
// Import entire file with a name
import bitwise from './libs/simple-bitwise.bscript'

// Use it multiple times
bitwise  // First call - inlines the code
bitwise  // Second call - inlines again
```

### Defining Named Blocks

Use `@define` markers in library files:

```javascript
// In libs/operations.bscript:
// @define andOp
12 10 and
// @end

// @define orOp
12 10 or
// @end

// In your script:
import andOp from './libs/operations.bscript'
import orOp from './libs/operations.bscript'

andOp  // Executes: 12 10 and
orOp   // Executes: 12 10 or
```

### Multiple Named Imports

```javascript
import { andOp, orOp } from './libs/operations.bscript'

andOp
verify
orOp
verify
```

## Macro System

Built-in macros that expand to base opcodes before execution:

### xSwap_n
Swap top stack item with nth-from-top:
```javascript
xSwap_2  // Expands to: 2 roll swap 1 roll
```

### xDrop_n
Drop nth-from-top stack item:
```javascript
xDrop_3  // Expands to: 3 roll drop
```

### xRot_n
Rotate nth-from-top item to the top:
```javascript
xRot_4  // Expands to: 4 roll
```

### hashCat
Duplicate, hash, and concatenate:
```javascript
hashCat  // Expands to: dup sha256 swap cat
```

### Preimage field extractors
Each consumes a preimage from the stack and leaves one field. `checkPreimage`
leaves the preimage where it found it, so `dup` before every extractor but the
last:

```javascript
extractVersion        // nVersion, as a number
extractHashPrevouts   // hashPrevouts, 32 bytes
extractHashSequence   // hashSequence, 32 bytes
extractOutpoint       // the outpoint, 36 bytes
extractInputIndex     // the input index, as a number
extractAmount         // the input amount in satoshis, as a number
extractSequence       // nSequence, as a number
extractOutputHash     // hashOutputs, 32 bytes
extractLocktime       // nLocktime, as a number
extractSigHashType    // the sighash type, as a number
```

### LOOP[n]{body}
Compile-time loop unrolling:
```javascript
LOOP[5]{100 add}  // Expands to: 100 add 100 add 100 add 100 add 100 add

// With iteration variable $i:
LOOP[3]{$i}  // Expands to: 0 1 2
```

## Opcode Categories

### Stack Manipulation
- **dup** - Duplicate top stack item
- **drop** - Remove top stack item
- **swap** - Swap top two items
- **over** - Copy second item to top
- **rot** - Rotate top 3 items
- **pick** - Copy nth item to top
- **roll** - Move nth item to top
- **2dup** - Duplicate top two items
- **2drop** - Remove top two items
- **2swap** - Swap top two pairs
- **3dup** - Duplicate top three items
- **nip** - Remove second item
- **tuck** - Copy top below second
- **toAltStack** - Move to alternate stack
- **fromAltStack** - Move from alternate stack

### Arithmetic
- **add**, **sub**, **mul**, **div**, **mod** - Basic math
- **negate** - Negate value
- **abs** - Absolute value
- **min**, **max** - Minimum/maximum
- **within** - Check if value in range
- **1add**, **1sub** - Increment/decrement by 1
- **2mul**, **2div** - Double/halve, truncating toward zero

### Bitwise Operations
- **and**, **or**, **xor** - Bitwise logic
- **lShift**, **rShift** - Shift the bytes
- **lShiftNum**, **rShiftNum** - Shift the number
- **invert** - Bitwise NOT

### Comparison
- **equal**, **equalVerify** - Check equality
- **lessThan**, **greaterThan** - Numeric comparison
- **lessThanOrEqual**, **greaterThanOrEqual**
- **0notEqual** - Check if non-zero
- **numEqual**, **numEqualVerify**, **numNotEqual** - Numeric equality
- **booland**, **boolor** - Both non-zero / either non-zero

### Cryptographic
- **sha256** - SHA-256 hash
- **sha1** - SHA-1 hash
- **ripemd160** - RIPEMD-160 hash
- **hash256** - Double SHA-256 (Bitcoin hash)
- **hash160** - SHA-256 then RIPEMD-160 (Bitcoin address hash)
- **checkSig**, **checkSigVerify** - Check a signature
- **checkMultiSig**, **checkMultiSigVerify** - Check m-of-n signatures
- **checkPreimage** - OP_PUSH_TX: prove the preimage on the stack belongs to this spend

### Flow Control
- **if** ... **else** ... **endIf** - Conditional branching
- **notIf** ... **endIf** - Negated conditional
- **verify** - Fail if top is false
- **return** - Exit script immediately
- **codeSeparator** - Start the subscript a later signature check covers
- **ver** - Push the transaction version as four little-endian bytes
- **verIf** ... **endIf** - Branch when the top item is that version
- **verNotIf** ... **endIf** - Negated version branch

### String/Byte Operations (BSV Restored)
- **cat** - Concatenate top two items
- **split** - Split at position
- **num2bin** - Convert number to binary
- **bin2num** - Convert binary to number
- **size** - Get byte length
- **substr** - Take length bytes from an offset
- **left**, **right** - Take bytes from either end

### Constants
- **true**, **false** - Boolean values
- **0** through **16** and **-1** - Single-byte number literals
- Any other integer becomes a minimally encoded push

## Debugging

### Run Modes
- **Run (Cmd/Ctrl + Enter)** - Execute entire script
- **Step (F10)** - Execute one instruction at a time
- **Reset (Cmd/Ctrl + R)** - Clear execution state

### Initial Stack
Use the left panel to define values pushed onto the stack before execution.
Values are space separated, bottom to top. Each one is either a decimal number
(`42`, `-7`) or a `0x` hex literal (`0xdeadbeef`). Anything else is dropped,
with a message saying why.

### Execution History
View all executed opcodes with descriptions in the debugger panel.

### Stack Visualization
Monitor main and alternate stacks in real-time during execution.

## Transaction Version

Settings holds the transaction version the script is judged under, and it
changes the rules, not just a number.

**Version 1** is strict:
- pushes must use the smallest encoding available
- numbers must not carry a byte they do not need
- signatures must be low-S, and `checkMultiSig` must leave a null dummy
- exactly one item may remain on the stack at the end (clean stack)
- a signature may not use the Chronicle sighash type (bit 0x20)

**Version 2 and above** relax all of them.

Either way the script fails if the stack is empty at the end or the top item is
false. Teaching scripts that leave several values on the stack need version 2,
and the shipped examples say so in a comment at the top.

## Signature Verification

By default `checkSig` and `checkMultiSig` are simulated: they check the shape of
the signature, not its validity, so script logic can be tested without a
transaction. Turn on signature verification in Settings and supply a
transaction context to have them checked for real. The context can be:

- a **sighash** you paste in directly
- a **raw transaction** plus input index, previous locking script and satoshis
- a **preimage** built from those same fields, which the panel can compute and
  inject onto the stack

## Verify (Cmd/Ctrl + Shift + V)

Runs the same script through Rúnar's `ScriptVM` and compares the result with
this interpreter. The console reports one of:

- **MATCH** - both engines agree
- a **mismatch**, with what each engine returned
- **Not compared**, with the reason. A script that checks a signature this
  interpreter only simulates cannot be compared, because the ScriptVM checks it
  for real.

A script calling `checkPreimage` needs a preimage belonging to the spend the
ScriptVM builds. Verify derives one and substitutes it for the initial stack.
The `Substitute a matching preimage` setting turns that off.

## Chain Mode

Load a `.bsm.json` project to step a stateful contract through its methods. The
contract's state lives after an `OP_RETURN` in the locking script, and each
method has an unlocking script. The chain panel simulates the transitions
locally; it does not broadcast anything.

## Keyboard Shortcuts

- **Cmd/Ctrl + N** - New Script
- **Cmd/Ctrl + O** - Open Script
- **Cmd/Ctrl + S** - Save
- **Cmd/Ctrl + Shift + S** - Save As
- **Cmd/Ctrl + Enter** - Execute Script
- **F10** - Step Through
- **Cmd/Ctrl + R** - Reset Execution
- **Cmd/Ctrl + Shift + V** - Verify with ScriptVM
- **Cmd/Ctrl + /** - Show Shortcuts

## Examples

Example scripts are available in the `examples/` directory:
- `arithmetic.bscript` - Math operations
- `stack-operations.bscript` - Stack manipulation
- `conditionals.bscript` - IF/ELSE branching
- `alt-stack.bscript` - Alternate stack
- `bitwise.bscript` - Bitwise operations
- `hash-puzzle.bscript` - Proof of knowledge of a preimage
- `p2pkh-checksig.bscript` - Pay to public key hash
- `multisig-2of3.bscript` - 2-of-3 multisig
- `import-example.bscript` - Wildcard imports
- `named-import-example.bscript` - Named imports
- `macros.bscript` - Built-in macro usage
- `op-push-tx.bscript` - `checkPreimage` and the preimage fields
- `covenant-locktime.bscript` - A covenant on nLocktime
- `covenant-output-hash.bscript` - A covenant on the outputs
- `covenant-rate-limit.bscript` - An owner signature plus a covenant
- `counter-chain/` - A stateful contract for chain mode

## Notes

- Script numbers are **arbitrary width**, held as BigInt. Arithmetic is not
  capped at 32 bits, and a number is encoded in the fewest bytes that hold it.
- Scripts execute **sequentially** with static branching only
- No dynamic looping - use compile-time `LOOP` macro
- Import paths are relative to current file
- Named imports behave like inline macro expansion
