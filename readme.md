# SVSCRIPT - Bitcoin Script Interpreter & Debugger

A powerful desktop application for developing, executing, and debugging Bitcoin Script with visual stack inspection. Built with Electron and Monaco Editor.

## Features

### Editor & Debugging
- **Monaco Editor Integration**: Professional code editor with Bitcoin Script syntax highlighting
- **Step-Through Debugger**: Execute scripts line-by-line or instruction-by-instruction (F10)
- **Visual Line Indicators**: Green glyph shows current execution position
- **Error Highlighting**: Red markers and persistent error toasts with helpful messages
- **Initial Stack Input**: Space-separated values with live preview

### Script Execution
- **Stack-Based Execution**: Real-time visualization of main and alternate stacks
- **Execution History**: Complete log of all executed opcodes with descriptions
- **76 Implemented Opcodes**: Full BSV opcode set including restored opcodes (CAT, SPLIT, MUL, etc.)
- **Real Cryptographic Hashing**: SHA256, SHA1, RIPEMD160, HASH256, HASH160 via BSV SDK
- **Simulated Signatures**: checkSig opcodes for testing script logic without transaction context

### Development Tools
- **Macro System**: xSwap_n, xDrop_n, xRot_n, hashCat, LOOP[n]{body}
- **Import System**: Modular scripts with named and wildcard imports
- **Example Library**: Pre-built scripts and importable macro libraries

### File Management
- **Native Menus**: Platform-specific File/Edit/View/Run/Help menus
- **Recent Files**: Quick access to recently opened scripts
- **Autosave Warnings**: Prompts before losing unsaved work
- **Smart Defaults**: File dialogs open to examples folder

### Built-in Help
- **Comprehensive Documentation**: Searchable help panel with all opcode references
- **Keyboard Shortcuts**: Quick access guide
- **Example Files**: Click-to-open examples

### Configuration
- **Settings Panel**: Toggle signature verification mode
- **Network Selection**: Choose mainnet/testnet/regtest
- **Persistent Preferences**: Settings saved across sessions

### Security
- **Electron Security Best Practices**: Context isolation, sandboxing, no node integration
- **Secure IPC**: All main process communication via contextBridge

## Installation

```bash
# Install dependencies
npm install

# Run the application
npm start

# Run in development mode (with DevTools)
npm run dev
```

## Bitcoin Script Syntax

SVSCRIPT uses **camelCase** keywords for opcodes instead of the traditional OP_CODE format:

### Examples

Traditional Bitcoin Script:
```
OP_DUP OP_HASH160 OP_EQUALVERIFY OP_CHECKSIG
```

SVSCRIPT Syntax:
```
dup hash160 equalVerify checkSig
```

## Supported Opcodes

### Constants
- `false`, `true`, `0`, `1`

### Flow Control
- `nop`, `if`, `notIf`, `else`, `endIf`, `verify`, `return`

### Stack Operations
- `toAltStack`, `fromAltStack`, `ifDup`, `depth`, `drop`, `dup`
- `nip`, `over`, `pick`, `roll`, `rot`, `swap`, `tuck`
- `2drop`, `2dup`, `3dup`, `2over`, `2rot`, `2swap`

### Arithmetic
- `add`, `sub`, `mul`, `div`, `mod`, `negate`, `abs`, `not`
- `0notEqual`, `1add`, `1sub`, `min`, `max`, `within`

### Bitwise Logic
- `and`, `or`, `xor`, `invert`, `lShift`, `rShift`

### Comparison
- `equal`, `equalVerify`, `lessThan`, `greaterThan`
- `lessThanOrEqual`, `greaterThanOrEqual`
- `numEqual`, `numEqualVerify`, `numNotEqual`

### String Operations (BSV Restored)
- `cat`, `split`, `num2bin`, `bin2num`, `size`

### Cryptographic
- `ripemd160`, `sha1`, `sha256`, `hash160`, `hash256`
- `checkSig`, `checkSigVerify`, `checkMultiSig`, `checkMultiSigVerify`
- `checkDataSig`, `checkDataSigVerify` (BSV)

## Usage

### Basic Script Example

```javascript
// Push two numbers and add them
5 10 add

// Duplicate the result
dup

// Swap and multiply
15 swap mul

// Result: 225
```

### Conditional Execution

```javascript
// Check if a number is positive
42
dup 0 greaterThan

if
  100 add
else
  100 sub
endIf

// Result: 142
```

### Stack Manipulation

```javascript
// Demonstrate stack operations
1 2 3

// Stack: [1, 2, 3]
dup
// Stack: [1, 2, 3, 3]

swap
// Stack: [1, 2, 3, 3]

over
// Stack: [1, 2, 3, 3, 3]
```

### Using Alternate Stack

```javascript
// Move values to alternate stack
10 20 30

toAltStack
// Main: [10, 20], Alt: [30]

toAltStack
// Main: [10], Alt: [20, 30]

fromAltStack
// Main: [10, 20], Alt: [30]
```

## Keyboard Shortcuts

- **Ctrl/Cmd + Enter**: Run entire script
- **F10**: Step through script (one instruction at a time)

## Debugger Interface

The debugger provides:

1. **Main Stack**: Shows all values on the main execution stack (top to bottom)
2. **Alternate Stack**: Shows values moved to the alternate stack
3. **Execution History**: Complete log of executed opcodes with descriptions
4. **Execution State**:
   - Current instruction pointer
   - Total instructions
   - Number of executed instructions
5. **Console Output**: Logs, errors, and execution results

## Script Execution Modes

### Run Mode
- Executes the entire script at once
- Shows final stack state and any errors
- Highlights the error location if execution fails

### Step Mode
- Press F10 to start stepping
- Each F10 press executes one instruction
- Watch stack changes in real-time
- Perfect for understanding complex scripts

## Architecture

### Security Features
- **Context Isolation**: Renderer process isolated from main process
- **Node Integration Disabled**: No direct Node.js access in renderer
- **Preload Scripts**: Secure IPC bridge using contextBridge
- **Content Security Policy**: Strict CSP headers

### Stack-Based Execution
- 32-bit signed integer arithmetic
- Non-recursive execution model
- Static branching only (IF/ELSE/ENDIF)
- No dynamic looping

### Files Structure
```
svscript/
├── src/
│   ├── main/
│   │   └── main.js              # Electron main process
│   ├── preload/
│   │   └── preload.js           # Secure IPC bridge
│   └── renderer/
│       ├── index.html           # Application UI
│       ├── styles.css           # Application styles
│       ├── app.js               # Main application logic
│       ├── interpreter.js       # Bitcoin Script interpreter engine
│       └── syntax.js            # Monaco Editor language definition
├── package.json
└── README.md
```

## Development

### Adding New Opcodes

1. Add opcode to `interpreter.js` in the `opcodeMap` object
2. Implement the opcode method (e.g., `op_newopcode()`)
3. Add opcode to syntax highlighting in `syntax.js` keywords array
4. Test with example scripts

### Customizing the Editor

Monaco Editor configuration can be modified in `app.js`:
```javascript
editor = monaco.editor.create(document.getElementById('editor-container'), {
  // Your custom settings here
  fontSize: 14,
  theme: 'bitcoinscript-dark',
  // ... more options
});
```

## Bitcoin Script Execution Model

Bitcoin Script is a stack-based, Forth-like language with these characteristics:

- **Stack-based**: All operations work with a stack (LIFO data structure)
- **No loops**: Only static branching with IF/ELSE/ENDIF
- **Integer arithmetic**: 32-bit signed integers
- **Two stacks**: Main stack and alternate stack for temporary storage
- **Deterministic**: Same script always produces same result
- **Non-Turing complete**: Intentionally limited for security

## Technical Details

### Stack Visualization
The stack display shows:
- Index position (0 = bottom, top = highest index)
- Value (with type information)
- Values are displayed top-to-bottom for intuitive understanding

### Execution History
Each entry shows:
- Instruction pointer position
- Opcode executed
- Human-readable description
- Stack snapshot at that point (available in code)

### Error Handling
- Stack underflow detection
- Division by zero prevention
- Invalid opcode detection
- Type conversion errors
- Verification failures

## License

MIT

## Contributing

This is a development tool for Bitcoin Script. Contributions welcome for:
- Additional opcode implementations
- Improved error messages
- Enhanced visualization features
- Performance optimizations
- Documentation improvements

## Credits

Built with:
- [Electron](https://www.electronjs.org/) - Desktop application framework
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor
- Bitcoin SV opcode specification
