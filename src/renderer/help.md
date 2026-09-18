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

### Cryptographic
- **sha256** - SHA-256 hash
- **sha1** - SHA-1 hash
- **ripemd160** - RIPEMD-160 hash
- **hash256** - Double SHA-256 (Bitcoin hash)
- **hash160** - SHA-256 then RIPEMD-160 (Bitcoin address hash)

### Flow Control
- **if** ... **else** ... **endIf** - Conditional branching
- **notIf** ... **endIf** - Negated conditional
- **verify** - Fail if top is false
- **return** - Exit script immediately
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
- **0** through **16** - Number literals
- **1negate** - Push -1

## Debugging

### Run Modes
- **Run (Cmd/Ctrl + Enter)** - Execute entire script
- **Step (F10)** - Execute one instruction at a time
- **Reset (Cmd/Ctrl + R)** - Clear execution state

### Initial Stack
Use the left panel to define values pushed onto the stack before execution. Enter one value per line (bottom to top).

### Execution History
View all executed opcodes with descriptions in the debugger panel.

### Stack Visualization
Monitor main and alternate stacks in real-time during execution.

## Keyboard Shortcuts

- **Cmd/Ctrl + N** - New Script
- **Cmd/Ctrl + O** - Open Script
- **Cmd/Ctrl + S** - Save
- **Cmd/Ctrl + Shift + S** - Save As
- **Cmd/Ctrl + Enter** - Execute Script
- **F10** - Step Through
- **Cmd/Ctrl + R** - Reset Execution
- **Cmd/Ctrl + /** - Show Shortcuts

## Examples

Example scripts are available in the `examples/` directory:
- `arithmetic.bscript` - Math operations
- `stack-operations.bscript` - Stack manipulation
- `conditionals.bscript` - IF/ELSE branching
- `bitwise.bscript` - Bitwise operations
- `import-example.bscript` - Wildcard imports
- `named-import-example.bscript` - Named imports
- `macros.bscript` - Built-in macro usage

## Notes

- All arithmetic operates on **32-bit signed integers**
- Scripts execute **sequentially** with static branching only
- No dynamic looping - use compile-time `LOOP` macro
- Import paths are relative to current file
- Named imports behave like inline macro expansion
