# SVSCRIPT Quick Start Guide

## Install and run

```bash
npm install
npm start
```

That is the whole setup. The Rúnar code behind Verify, Deploy and preimage
computation is vendored under `src/vendor/runar`, so there is nothing to link.

## First script

SVSCRIPT opens on a default script. Press **Cmd/Ctrl + Enter** to run it, watch
the stack panel fill, and read the result in the console.

## The end-of-script rules

A script does not only have to run, it has to end in a valid state. At the
default **transaction version 1** that means:

- the stack is not empty
- the top item is true
- exactly one item is left (the clean stack rule)

Set the version to 2 in Settings to relax the clean stack rule, which is what
the teaching examples below need when they leave several values on the stack.

## Step-by-step debugging

Enter this script:

```
10 20 add
dup
5 mul
```

Press **F10** repeatedly:

| Press | Instruction | Stack |
|---|---|---|
| 1 | `10` | `[10]` |
| 2 | `20` | `[10, 20]` |
| 3 | `add` | `[30]` |
| 4 | `dup` | `[30, 30]` |
| 5 | `5` | `[30, 30, 5]` |
| 6 | `mul` | `[30, 150]` |

Two items are left, so this one needs transaction version 2. At version 1 the
last step reports a clean-stack failure, which is the rule a node would apply.

## The interface

### Initial stack (left)
Values pushed before the script runs, space separated, bottom to top. Each item
is either a decimal number or a `0x` hex literal. Anything else is dropped with
a message.

### Editor (centre)
Syntax highlighting, completion, and a glyph marking the current instruction.

### Debugger (right)
Main stack, alternate stack, execution history, and the instruction pointer.

### Console (bottom)
Results, errors and status.

## Try these

### Arithmetic

```
// (10 + 5) * 3 = 45
10 5 add
3 mul
```

### Stack operations

```
100
dup     // [100, 100]
200     // [100, 100, 200]
swap    // [100, 200, 100]
add     // [100, 300]
```

### Conditionals

```
-5
dup 0 greaterThan

if
  abs   // not taken
else
  abs   // taken
endIf

// [5]
```

### Alternate stack

```
1 2 3
toAltStack      // move 3 aside
add             // 1 + 2 = 3
fromAltStack    // bring 3 back
mul             // 3 * 3 = 9
```

### A hash puzzle

Put `42` in the initial stack and run:

```
sha256
0x684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1
equal
```

One item, true, so this passes at version 1.

## Cross-check with a second engine

Press **Cmd/Ctrl + Shift + V** to run the same script through Rúnar's
`ScriptVM` and compare the two results. The console reports `MATCH`,
`BOTH FAILED`, `MISMATCH`, or the reason the two engines were not compared.

## Load an example

`File > Open` starts in `examples/`:

| File | What it shows |
|---|---|
| `arithmetic.bscript` | Arithmetic opcodes |
| `stack-operations.bscript` | Stack manipulation |
| `conditionals.bscript` | IF/ELSE/ENDIF |
| `alt-stack.bscript` | Alternate stack |
| `bitwise.bscript` | Bitwise opcodes |
| `hash-puzzle.bscript` | Proof of knowledge of a preimage |
| `p2pkh-checksig.bscript` | Pay to public key hash |
| `multisig-2of3.bscript` | 2-of-3 multisig |
| `macros.bscript` | Built-in macros |
| `import-example.bscript` | Wildcard imports |
| `named-import-example.bscript` | Named imports |
| `op-push-tx.bscript` | `checkPreimage` and the preimage fields |
| `covenant-locktime.bscript` | A covenant on nLocktime |
| `covenant-output-hash.bscript` | A covenant on the outputs |
| `covenant-rate-limit.bscript` | An owner signature plus a covenant |
| `counter-chain/` | A stateful contract for chain mode |

Scripts that need transaction version 2 say so in a comment at the top.

## Common mistakes

```
add          // stack underflow: add needs two items
10 0 div     // division by zero
10 5 sub     // 5, not -5: the second item is subtracted from the first
```

At version 1 one more failure is common: more than one item left at the end.

## Next steps

- `user-guide.md` for the full guide: transaction versions, signatures, Verify,
  covenants, chain mode and deployment
- `readme.md` for the opcode list and feature reference
- The in-app help panel for macros, imports and opcode descriptions
- `development.md` to extend the app
