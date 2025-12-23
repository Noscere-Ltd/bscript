# SVSCRIPT Quick Start Guide

Get started with SVSCRIPT in under 5 minutes!

## Installation & Running

```bash
# Navigate to project directory
cd /Users/craig/noscere/bsvapps/svscript

# Install dependencies (first time only)
npm install

# Start the application
npm start
```

## First Script

When SVSCRIPT opens, you'll see a default example script. Try running it:

1. Press **Ctrl/Cmd + Enter** to run the entire script
2. Watch the stack visualization update in real-time
3. Check the console output for results

## Step-by-Step Debugging

Let's debug a simple script step by step:

1. Clear the editor and enter this script:
```
10 20 add
dup
5 mul
```

2. Press **F10** to enter step mode
3. Press **F10** again to execute each instruction:
   - First F10: Pushes 10 → Stack: [10]
   - Second F10: Pushes 20 → Stack: [10, 20]
   - Third F10: Executes add → Stack: [30]
   - Fourth F10: Executes dup → Stack: [30, 30]
   - Fifth F10: Pushes 5 → Stack: [30, 30, 5]
   - Sixth F10: Executes mul → Stack: [30, 150]

4. Watch the stack visualization update with each step!

## Understanding the Interface

### Editor Panel (Left)
- Write your Bitcoin Script code here
- Syntax highlighting for all opcodes
- Current line highlighted during execution

### Debugger Panel (Right)
- **Main Stack**: Shows current stack state (top to bottom)
- **Alternate Stack**: Shows values moved with toAltStack
- **Execution History**: Log of executed opcodes
- **State**: Instruction pointer and execution counters

### Console (Bottom)
- Execution results
- Error messages
- Status updates

## Try These Examples

### Example 1: Basic Arithmetic
```
// Calculate (10 + 5) * 3
10 5 add
3 mul
// Expected result: 45
```

### Example 2: Stack Operations
```
// Demonstrate dup and swap
100
dup     // Stack: [100, 100]
200     // Stack: [100, 100, 200]
swap    // Stack: [100, 200, 100]
add     // Stack: [100, 300]
```

### Example 3: Conditionals
```
// Check if number is positive
-5
dup 0 greaterThan

if
  abs   // Make positive if negative (won't execute)
else
  abs   // This executes
endIf

// Result: 5
```

### Example 4: Alternate Stack
```
// Use alt stack for temporary storage
1 2 3
toAltStack      // Move 3 to alt stack
add             // Add 1 + 2 = 3
fromAltStack    // Bring back 3
mul             // 3 * 3 = 9
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + Enter | Run entire script |
| F10 | Step through execution |
| - | - |

## Load Example Scripts

Example scripts are in the `examples/` folder:

- `arithmetic.bscript` - Arithmetic operations
- `stack-operations.bscript` - Stack manipulation
- `conditionals.bscript` - IF/ELSE/ENDIF
- `alt-stack.bscript` - Alternate stack usage
- `bitwise.bscript` - Bitwise operations

Copy the content from any example into the editor to try them out!

## Common Pitfalls

### Stack Underflow
```
// ERROR: Not enough items on stack
add  // Needs 2 items, stack is empty
```

### Division by Zero
```
// ERROR: Division by zero
10 0 div
```

### Wrong Order
```
// Remember: Stack is LIFO (Last In, First Out)
10 5 sub  // Result: 5 (not -5)
// Because: 10 - 5 = 5
```

## Next Steps

1. Read the full [README.md](README.md) for detailed documentation
2. Check [claude.md](claude.md) for complete opcode reference
3. Experiment with different opcodes
4. Try creating your own scripts!

## Need Help?

- **Opcode Reference**: See [claude.md](claude.md)
- **Full Documentation**: See [README.md](README.md)
- **Stack Behavior**: Watch the stack visualization as you step through
- **Errors**: Check console output for detailed error messages

## Tips for Learning

1. **Start Simple**: Begin with basic arithmetic before complex scripts
2. **Use Step Mode**: F10 stepping helps understand execution flow
3. **Watch the Stack**: Keep an eye on stack changes
4. **Read History**: Execution history shows what each opcode did
5. **Experiment**: Try modifying examples to see what happens!

Happy Scripting!
