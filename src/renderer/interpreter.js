/**
 * Bitcoin Script Interpreter Engine
 * Implements BSV Bitcoin Script opcodes with stack-based execution
 */

class ScriptInterpreter {
  constructor() {
    this.reset();
  }

  reset() {
    this.mainStack = [];
    this.altStack = [];
    this.instructions = [];
    this.instructionLines = []; // Track which source line each instruction came from
    this.ip = 0; // instruction pointer
    this.executionHistory = [];
    this.status = 'idle'; // idle, running, success, error
    this.error = null;
    this.breakpoints = new Set();
    this.skipIPIncrement = false; // Flag to prevent double-increment in flow control
    this.condStack = []; // One entry per open if/notIf block: is that branch taken?
    this.namedImports = {}; // Store named imports for later expansion

    // Settings (preserved across resets)
    if (!this.enableSignatures) this.enableSignatures = false;
    if (!this.network) this.network = 'mainnet';

    // Transaction context for signature verification (preserved across resets)
    if (!this.txContext) this.txContext = null;
    if (!this.txContextMode) this.txContextMode = null;
  }

  // Set transaction context for checkSig/checkMultiSig verification
  setTransactionContext(context) {
    if (!context) {
      this.txContext = null;
      this.txContextMode = null;
      return;
    }

    if (context.sighash) {
      // Pre-computed sighash mode (simplest)
      this.txContext = { sighash: context.sighash };
      this.txContextMode = 'sighash';
    } else if (context.txHex && context.inputIndex !== undefined) {
      // Full transaction context mode
      this.txContext = {
        txHex: context.txHex,
        inputIndex: context.inputIndex,
        prevScriptHex: context.prevScriptHex,
        satoshis: context.satoshis,
        sighashType: context.sighashType
      };
      this.txContextMode = 'transaction';
    }
  }

  // A stack item holding bytes, written as 0x-prefixed hex
  isHexValue(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);
  }

  // Encode a number as Bitcoin Script does: little-endian, sign-magnitude,
  // minimally encoded, with zero as no bytes at all
  numToHex(value) {
    let magnitude = Math.abs(Math.trunc(value));
    const bytes = [];
    while (magnitude > 0) {
      bytes.push(magnitude % 256);
      magnitude = Math.floor(magnitude / 256);
    }
    if (bytes.length === 0) return '';
    if (bytes[bytes.length - 1] & 0x80) {
      bytes.push(value < 0 ? 0x80 : 0x00);
    } else if (value < 0) {
      bytes[bytes.length - 1] |= 0x80;
    }
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Decode little-endian sign-magnitude bytes back to a number
  hexToNum(hex) {
    const byteCount = Math.floor(hex.length / 2);
    let num = 0;
    let negative = false;
    for (let i = byteCount - 1; i >= 0; i--) {
      let byte = parseInt(hex.substr(i * 2, 2), 16);
      if (i === byteCount - 1 && (byte & 0x80)) {
        negative = true;
        byte &= 0x7f;
      }
      num = num * 256 + byte;
    }
    return negative ? -num : num;
  }

  // Convert stack value to hex string for signature verification
  toHexString(value) {
    if (typeof value === 'string') {
      // Already hex if starts with 0x, strip prefix
      if (value.startsWith('0x')) {
        return value.slice(2);
      }
      // Check if already valid hex
      if (/^[0-9a-fA-F]+$/.test(value)) {
        return value;
      }
      // Convert UTF-8 string to hex bytes
      let hex = '';
      for (let i = 0; i < value.length; i++) {
        hex += value.charCodeAt(i).toString(16).padStart(2, '0');
      }
      return hex;
    }
    if (typeof value === 'number') {
      return this.numToHex(value);
    }
    if (Array.isArray(value)) {
      return value.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return String(value);
  }

  // Resolve imports in script text
  async resolveImports(scriptText, currentFilePath = null, importedFiles = new Set()) {
    // Track imported files to prevent circular imports
    if (currentFilePath) {
      importedFiles.add(currentFilePath);
    }

    // Match import statements
    // Supports:
    // - import macroName from './file.bscript'
    // - import { macro1, macro2 } from './file.bscript'
    // - import * from './file.bscript'
    const importRegex = /import\s+(?:(\w+)|\{([^}]+)\}|\*)\s+from\s+['"]([^'"]+)['"]/g;

    let resolved = scriptText;
    const imports = [];
    let match;

    // Collect all import statements
    while ((match = importRegex.exec(scriptText)) !== null) {
      imports.push({
        full: match[0],
        macroName: match[1],  // Single macro name
        macroList: match[2],  // Multiple macros {a, b, c}
        isWildcard: match[0].includes('import *'),
        path: match[3]
      });
    }

    // Process each import
    for (const imp of imports) {
      try {
        // Resolve relative path
        let resolvedPath = imp.path;

        // If we have a current file path, resolve relative to it
        if (currentFilePath && window.electronAPI && window.electronAPI.resolveImportPath) {
          const result = await window.electronAPI.resolveImportPath(currentFilePath, imp.path);
          if (result.success) {
            resolvedPath = result.resolvedPath;
          }
        }

        // Check for circular imports
        if (importedFiles.has(resolvedPath)) {
          throw new Error(`Circular import detected: ${resolvedPath}`);
        }

        // Load the imported file
        if (window.electronAPI && window.electronAPI.readImportFile) {
          const result = await window.electronAPI.readImportFile(resolvedPath);

          if (!result.success) {
            throw new Error(`Failed to load ${imp.path}: ${result.error}`);
          }

          // Recursively resolve imports in the imported file
          let importedContent = await this.resolveImports(
            result.content,
            resolvedPath,
            new Set(importedFiles)
          );

          // Handle different import types
          if (imp.isWildcard) {
            // import * - include all content inline (immediate replacement)
            resolved = resolved.replace(imp.full, importedContent);
          } else if (imp.macroName) {
            // import macroName - store as named macro for later expansion
            const macroContent = this.extractMacro(importedContent, imp.macroName);
            this.namedImports[imp.macroName] = macroContent || '';
            // Remove the import statement
            resolved = resolved.replace(imp.full, '');
          } else if (imp.macroList) {
            // import { macro1, macro2 } - store each as named macro
            const macros = imp.macroList.split(',').map(m => m.trim());
            macros.forEach(macroName => {
              const macroContent = this.extractMacro(importedContent, macroName);
              this.namedImports[macroName] = macroContent || '';
            });
            // Remove the import statement
            resolved = resolved.replace(imp.full, '');
          }
        } else {
          // No import API available, remove import statement
          resolved = resolved.replace(imp.full, `// Import not available: ${imp.path}`);
        }
      } catch (error) {
        // Replace import with error comment
        resolved = resolved.replace(imp.full, `// Import error: ${error.message}`);
        console.error('Import error:', error);
      }
    }

    return resolved;
  }

  // Extract a specific macro definition from imported content
  extractMacro(content, macroName) {
    // Look for @define macroName ... @end blocks
    const defineRegex = new RegExp(`//\\s*@define\\s+${macroName}\\s*\\n([\\s\\S]*?)//\\s*@end`, 'm');
    const match = content.match(defineRegex);

    if (match) {
      return match[1].trim();
    }

    // If no @define block found, return the entire content as the macro
    // This allows simple files to be imported without @define/@end markers
    return content.trim();
  }

  // Expand macros in script text
  expandMacros(scriptText) {
    let expanded = scriptText;

    // First, expand named imports (user-defined macros from imports)
    // This allows imported names to be used like function calls
    for (const [name, code] of Object.entries(this.namedImports)) {
      // Create regex to match the name as a standalone word
      const nameRegex = new RegExp(`\\b${name}\\b`, 'g');
      expanded = expanded.replace(nameRegex, code);
    }

    // Expand LOOP macros: LOOP[n]{body}
    expanded = expanded.replace(/LOOP\[(\d+)\]\{([^}]+)\}/g, (match, count, body) => {
      const n = parseInt(count);
      const repetitions = [];
      for (let i = 0; i < n; i++) {
        // Replace $i with iteration index in body
        const iteration = body.replace(/\$i/g, i.toString());
        repetitions.push(iteration);
      }
      return repetitions.join(' ');
    });

    // Expand xSwap macros: xSwap_n (swap top with nth item)
    expanded = expanded.replace(/xSwap_(\d+)/g, (match, n) => {
      const depth = parseInt(n);
      if (depth === 0 || depth === 1) return 'swap'; // xSwap_1 is just swap

      // xSwap_n: roll n items to bring nth to top, swap, then roll back
      const rollForward = depth.toString();
      const rollBack = (depth - 1).toString();
      return `${rollForward} roll swap ${rollBack} roll`;
    });

    // Expand xDrop macros: xDrop_n (drop nth item)
    expanded = expanded.replace(/xDrop_(\d+)/g, (match, n) => {
      const depth = parseInt(n);
      if (depth === 0) return 'drop'; // xDrop_0 is just drop

      // xDrop_n: roll n items to bring nth to top, drop, then reverse remaining
      const rollForward = depth.toString();
      return `${rollForward} roll drop`;
    });

    // Expand xRot macros: xRot_n (rotate nth item to top)
    expanded = expanded.replace(/xRot_(\d+)/g, (match, n) => {
      const depth = parseInt(n);
      if (depth === 0 || depth === 1) return ''; // xRot_0/1 is nop

      // xRot_n: roll n items to bring nth to top
      return `${depth} roll`;
    });

    // Expand hashCat macro: duplicates, hashes, concatenates
    expanded = expanded.replace(/hashCat/g, () => {
      return 'dup sha256 swap cat';
    });

    // OP_PUSH_TX: checkPreimage expands to codeSeparator + push generator point G + checkSigVerify
    expanded = expanded.replace(/\bcheckPreimage\b/g,
      'codeSeparator 0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 checkSigVerify');

    // Preimage field extractors (each consumes preimage from stack)
    // Fixed-offset extractors (from start of preimage)
    expanded = expanded.replace(/\bextractVersion\b/g,       '4 split drop bin2num');
    expanded = expanded.replace(/\bextractHashPrevouts\b/g,  '4 split nip 32 split drop');
    expanded = expanded.replace(/\bextractHashSequence\b/g,  '36 split nip 32 split drop');
    expanded = expanded.replace(/\bextractOutpoint\b/g,      '68 split nip 36 split drop');
    expanded = expanded.replace(/\bextractInputIndex\b/g,    '100 split nip 4 split drop bin2num');

    // End-relative extractors (from end of preimage, handles variable scriptCode length)
    expanded = expanded.replace(/\bextractAmount\b/g,        'size 52 sub split nip 8 split drop bin2num');
    expanded = expanded.replace(/\bextractSequence\b/g,      'size 44 sub split nip 4 split drop bin2num');
    expanded = expanded.replace(/\bextractOutputHash\b/g,    'size 40 sub split nip 32 split drop');
    expanded = expanded.replace(/\bextractLocktime\b/g,      'size 8 sub split nip 4 split drop bin2num');
    expanded = expanded.replace(/\bextractSigHashType\b/g,   'size 4 sub split nip bin2num');

    return expanded;
  }

  // Parse script text into instruction tokens
  async parse(scriptText, initialStack = [], currentFilePath = null) {
    this.reset();

    // Load initial stack values if provided
    if (initialStack && initialStack.length > 0) {
      this.mainStack = [...initialStack];
    }

    // Resolve imports first
    const importResolved = await this.resolveImports(scriptText, currentFilePath);

    // Expand macros before tokenization
    const expandedScript = this.expandMacros(importResolved);

    const lines = expandedScript.split('\n');
    const tokens = [];
    const tokenLines = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      let line = lines[lineIndex];
      // Remove comments
      line = line.replace(/\/\/.*$/, '').trim();
      if (!line) continue;

      // Split by whitespace and process each token
      const lineTokens = line.split(/\s+/).filter(t => t);
      tokens.push(...lineTokens);

      // Track which line each token came from
      for (let i = 0; i < lineTokens.length; i++) {
        tokenLines.push(lineIndex);
      }
    }

    this.instructions = tokens;
    this.instructionLines = tokenLines;
    return tokens;
  }

  // Execute entire script
  async run(scriptText, initialStack = []) {
    try {
      await this.parse(scriptText, initialStack);
      this.status = 'running';

      while (this.ip < this.instructions.length) {
        await this.step();
        if (this.status === 'error') {
          return { success: false, error: this.error };
        }
      }

      if (this.condStack.length > 0) {
        throw new Error(`Script ended with ${this.condStack.length} unclosed if block(s)`);
      }

      this.status = 'success';
      return { success: true, stack: this.mainStack };
    } catch (error) {
      this.status = 'error';
      this.error = error.message;
      return { success: false, error: error.message };
    }
  }

  // Execute single instruction
  async step() {
    if (this.ip >= this.instructions.length) {
      if (this.condStack.length > 0) {
        this.status = 'error';
        this.error = `Script ended with ${this.condStack.length} unclosed if block(s)`;
        throw new Error(this.error);
      }
      this.status = 'success';
      return false;
    }

    const instruction = this.instructions[this.ip];
    this.skipIPIncrement = false; // Reset flag before executing instruction

    // Inside a branch that was not taken, only the conditionals themselves run
    if (!this.branchExecuting() && !['if', 'notIf', 'else', 'endIf'].includes(instruction)) {
      this.ip++;
      return true;
    }

    try {
      // Check if it's a number literal
      if (this.isNumber(instruction)) {
        const value = this.parseNumber(instruction);
        this.mainStack.push(value);
        this.addHistory(instruction, `Push ${value}`);
      } else if (this.isHexLiteral(instruction)) {
        // Hex literal (0x...)
        const bytes = this.parseHex(instruction);
        this.mainStack.push(bytes);
        this.addHistory(instruction, `Push ${instruction}`);
      } else {
        // Execute opcode
        await this.executeOpcode(instruction);
      }

      // Only increment IP if not skipped by flow control opcodes
      if (!this.skipIPIncrement) {
        this.ip++;
      }

      return true;
    } catch (error) {
      this.status = 'error';
      const lineNumber = this.instructionLines[this.ip];
      this.error = error.message;
      this.errorLine = lineNumber;
      this.errorInstruction = instruction;
      throw error;
    }
  }

  // Add to execution history
  addHistory(opcode, description) {
    this.executionHistory.push({
      ip: this.ip,
      opcode,
      description,
      stackSnapshot: [...this.mainStack],
      altStackSnapshot: [...this.altStack]
    });
  }

  // Check if token is a number
  isNumber(token) {
    return /^-?\d+$/.test(token);
  }

  // Check if token is hex literal
  isHexLiteral(token) {
    return /^0x[0-9a-fA-F]+$/.test(token);
  }

  // Parse number
  parseNumber(token) {
    return parseInt(token, 10);
  }

  // Parse hex literal
  parseHex(token) {
    return token; // For now, store as string; can be converted to Buffer later
  }

  // Execute opcode
  async executeOpcode(opcode) {
    const opcodeMap = {
      // Constants
      'false': () => this.op_false(),
      'true': () => this.op_true(),
      '0': () => this.op_false(),
      '1': () => this.op_true(),

      // Flow control
      'nop': () => this.op_nop(),
      'if': () => this.op_if(),
      'notIf': () => this.op_notif(),
      'else': () => this.op_else(),
      'endIf': () => this.op_endif(),
      'verify': () => this.op_verify(),
      'return': () => this.op_return(),
      'codeSeparator': () => this.op_codeseparator(),

      // Stack operations
      'toAltStack': () => this.op_toaltstack(),
      'fromAltStack': () => this.op_fromaltstack(),
      'ifDup': () => this.op_ifdup(),
      'depth': () => this.op_depth(),
      'drop': () => this.op_drop(),
      'dup': () => this.op_dup(),
      'nip': () => this.op_nip(),
      'over': () => this.op_over(),
      'pick': () => this.op_pick(),
      'roll': () => this.op_roll(),
      'rot': () => this.op_rot(),
      'swap': () => this.op_swap(),
      'tuck': () => this.op_tuck(),
      '2drop': () => this.op_2drop(),
      '2dup': () => this.op_2dup(),
      '3dup': () => this.op_3dup(),
      '2over': () => this.op_2over(),
      '2rot': () => this.op_2rot(),
      '2swap': () => this.op_2swap(),

      // Arithmetic
      'add': () => this.op_add(),
      'sub': () => this.op_sub(),
      'mul': () => this.op_mul(),
      'div': () => this.op_div(),
      'mod': () => this.op_mod(),
      'negate': () => this.op_negate(),
      'abs': () => this.op_abs(),
      'not': () => this.op_not(),
      '0notEqual': () => this.op_0notequal(),
      '1add': () => this.op_1add(),
      '1sub': () => this.op_1sub(),
      'min': () => this.op_min(),
      'max': () => this.op_max(),
      'within': () => this.op_within(),

      // Bitwise logic
      'and': () => this.op_and(),
      'or': () => this.op_or(),
      'xor': () => this.op_xor(),
      'invert': () => this.op_invert(),
      'lShift': () => this.op_lshift(),
      'rShift': () => this.op_rshift(),

      // Comparison
      'equal': () => this.op_equal(),
      'equalVerify': () => this.op_equalverify(),
      'lessThan': () => this.op_lessthan(),
      'greaterThan': () => this.op_greaterthan(),
      'lessThanOrEqual': () => this.op_lessthanorequal(),
      'greaterThanOrEqual': () => this.op_greaterthanorequal(),
      'numEqual': () => this.op_numequal(),
      'numEqualVerify': () => this.op_numequalverify(),
      'numNotEqual': () => this.op_numnotequal(),

      // String operations (BSV restored)
      'cat': () => this.op_cat(),
      'split': () => this.op_split(),
      'num2bin': () => this.op_num2bin(),
      'bin2num': () => this.op_bin2num(),
      'size': () => this.op_size(),

      // Crypto (async operations)
      'ripemd160': async () => await this.op_ripemd160(),
      'sha1': async () => await this.op_sha1(),
      'sha256': async () => await this.op_sha256(),
      'hash160': async () => await this.op_hash160(),
      'hash256': async () => await this.op_hash256(),
      'checkSig': async () => await this.op_checksig(),
      'checkSigVerify': async () => await this.op_checksigverify(),
      'checkMultiSig': async () => await this.op_checkmultisig(),
      'checkMultiSigVerify': async () => await this.op_checkmultisigverify(),
      'checkDataSig': async () => await this.op_checkdatasig(),
      'checkDataSigVerify': async () => await this.op_checkdatasigverify(),
    };

    const opcodeFunc = opcodeMap[opcode];
    if (!opcodeFunc) {
      throw new Error(`Unknown opcode: ${opcode}`);
    }

    await opcodeFunc();
  }

  // Stack manipulation helpers
  popStack() {
    if (this.mainStack.length === 0) {
      const currentInstruction = this.instructions[this.ip];
      throw new Error(`Cannot execute '${currentInstruction}' - stack is empty. This operation requires at least 1 item on the stack.`);
    }
    return this.mainStack.pop();
  }

  pushStack(value) {
    this.mainStack.push(value);
  }

  peekStack(depth = 0) {
    if (this.mainStack.length <= depth) {
      const currentInstruction = this.instructions[this.ip];
      const required = depth + 1;
      const available = this.mainStack.length;
      throw new Error(`Cannot execute '${currentInstruction}' - insufficient stack items. Required: ${required}, available: ${available}.`);
    }
    return this.mainStack[this.mainStack.length - 1 - depth];
  }

  // Convert stack value to number
  toNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
      if (this.isHexValue(value)) return this.hexToNum(value.slice(2));
      if (/^-?\d+$/.test(value.trim())) return parseInt(value, 10);
    }
    throw new Error(`Cannot convert '${value}' to a number`);
  }

  // Convert stack value to boolean. Bytes are false when every byte is zero,
  // where a lone sign bit in the last byte still counts as zero.
  toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      if (this.isHexValue(value)) {
        const hex = value.slice(2);
        for (let i = 0; i < hex.length; i += 2) {
          const byte = parseInt(hex.substr(i, 2), 16);
          if (byte === 0) continue;
          if (byte === 0x80 && i === hex.length - 2) continue;
          return true;
        }
        return false;
      }
      return value !== '' && value !== '0';
    }
    return false;
  }

  // Opcode implementations

  // Constants
  op_false() {
    this.pushStack(0);
    this.addHistory('false', 'Push 0');
  }

  op_true() {
    this.pushStack(1);
    this.addHistory('true', 'Push 1');
  }

  // Flow control
  op_nop() {
    this.addHistory('nop', 'No operation');
  }

  // Every instruction sits inside zero or more if/notIf blocks. It runs only
  // when all of them were taken.
  branchExecuting() {
    return this.condStack.every(Boolean);
  }

  openBranch(opcode, invert) {
    let taken = false;
    if (this.branchExecuting()) {
      taken = this.toBool(this.popStack());
      if (invert) taken = !taken;
    }
    this.condStack.push(taken);
    this.addHistory(opcode, `Conditional branch: ${taken}`);
  }

  op_if() {
    this.openBranch('if', false);
  }

  op_notif() {
    this.openBranch('notIf', true);
  }

  op_else() {
    if (this.condStack.length === 0) {
      throw new Error("Cannot execute 'else' - no matching if");
    }
    const taken = !this.condStack[this.condStack.length - 1];
    this.condStack[this.condStack.length - 1] = taken;
    this.addHistory('else', taken ? 'Enter else block' : 'Skip else block');
  }

  op_endif() {
    if (this.condStack.length === 0) {
      throw new Error("Cannot execute 'endIf' - no matching if");
    }
    this.condStack.pop();
    this.addHistory('endIf', 'End conditional block');
  }

  op_verify() {
    const value = this.popStack();
    if (!this.toBool(value)) {
      throw new Error('Verification failed');
    }
    this.addHistory('verify', 'Verification succeeded');
  }

  op_return() {
    this.addHistory('return', 'Script terminated');
    throw new Error('Script returned (OP_RETURN)');
  }

  op_codeseparator() {
    // No-op in the interpreter - OP_CODESEPARATOR only affects
    // BIP-143 scriptCode computation which happens at the SDK level
    this.addHistory('codeSeparator', 'Mark script code boundary (OP_CODESEPARATOR)');
  }

  // Stack operations
  op_toaltstack() {
    const value = this.popStack();
    this.altStack.push(value);
    this.addHistory('toAltStack', 'Move to alt stack');
  }

  op_fromaltstack() {
    if (this.altStack.length === 0) {
      throw new Error('Alt stack underflow');
    }
    const value = this.altStack.pop();
    this.pushStack(value);
    this.addHistory('fromAltStack', 'Move from alt stack');
  }

  op_ifdup() {
    const top = this.peekStack();
    if (this.toBool(top)) {
      this.pushStack(top);
      this.addHistory('ifDup', 'Duplicate top (non-zero)');
    } else {
      this.addHistory('ifDup', 'No duplicate (zero)');
    }
  }

  op_depth() {
    this.pushStack(this.mainStack.length);
    this.addHistory('depth', `Stack depth: ${this.mainStack.length}`);
  }

  op_drop() {
    this.popStack();
    this.addHistory('drop', 'Drop top item');
  }

  op_dup() {
    const top = this.peekStack();
    this.pushStack(top);
    this.addHistory('dup', 'Duplicate top');
  }

  op_nip() {
    const a = this.popStack();
    this.popStack();
    this.pushStack(a);
    this.addHistory('nip', 'Remove second item');
  }

  op_over() {
    const second = this.peekStack(1);
    this.pushStack(second);
    this.addHistory('over', 'Copy second item to top');
  }

  op_pick() {
    const n = this.toNumber(this.popStack());
    const value = this.peekStack(n);
    this.pushStack(value);
    this.addHistory('pick', `Copy item at depth ${n}`);
  }

  op_roll() {
    const n = this.toNumber(this.popStack());
    if (n < 0 || n >= this.mainStack.length) {
      throw new Error('Invalid roll depth');
    }
    const value = this.mainStack.splice(this.mainStack.length - 1 - n, 1)[0];
    this.pushStack(value);
    this.addHistory('roll', `Move item at depth ${n} to top`);
  }

  op_rot() {
    const a = this.popStack();
    const b = this.popStack();
    const c = this.popStack();
    this.pushStack(b);
    this.pushStack(a);
    this.pushStack(c);
    this.addHistory('rot', 'Rotate top 3 items');
  }

  op_swap() {
    const a = this.popStack();
    const b = this.popStack();
    this.pushStack(a);
    this.pushStack(b);
    this.addHistory('swap', 'Swap top 2 items');
  }

  op_tuck() {
    const a = this.popStack();
    const b = this.popStack();
    this.pushStack(a);
    this.pushStack(b);
    this.pushStack(a);
    this.addHistory('tuck', 'Copy top before second');
  }

  op_2drop() {
    this.popStack();
    this.popStack();
    this.addHistory('2drop', 'Drop top 2 items');
  }

  op_2dup() {
    const a = this.peekStack(0);
    const b = this.peekStack(1);
    this.pushStack(b);
    this.pushStack(a);
    this.addHistory('2dup', 'Duplicate top 2 items');
  }

  op_3dup() {
    const a = this.peekStack(0);
    const b = this.peekStack(1);
    const c = this.peekStack(2);
    this.pushStack(c);
    this.pushStack(b);
    this.pushStack(a);
    this.addHistory('3dup', 'Duplicate top 3 items');
  }

  op_2over() {
    const third = this.peekStack(2);
    const fourth = this.peekStack(3);
    this.pushStack(fourth);
    this.pushStack(third);
    this.addHistory('2over', 'Copy 3rd & 4th items to top');
  }

  op_2rot() {
    const a = this.popStack();
    const b = this.popStack();
    const c = this.popStack();
    const d = this.popStack();
    const e = this.popStack();
    const f = this.popStack();
    this.pushStack(d);
    this.pushStack(c);
    this.pushStack(b);
    this.pushStack(a);
    this.pushStack(f);
    this.pushStack(e);
    this.addHistory('2rot', 'Rotate top 6 items');
  }

  op_2swap() {
    const a = this.popStack();
    const b = this.popStack();
    const c = this.popStack();
    const d = this.popStack();
    this.pushStack(b);
    this.pushStack(a);
    this.pushStack(d);
    this.pushStack(c);
    this.addHistory('2swap', 'Swap top 2 pairs');
  }

  // Arithmetic operations
  op_add() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a + b);
    this.addHistory('add', `${a} + ${b} = ${a + b}`);
  }

  op_sub() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a - b);
    this.addHistory('sub', `${a} - ${b} = ${a - b}`);
  }

  op_mul() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a * b);
    this.addHistory('mul', `${a} * ${b} = ${a * b}`);
  }

  op_div() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    if (b === 0) throw new Error('Division by zero');
    this.pushStack(Math.trunc(a / b));
    this.addHistory('div', `${a} / ${b} = ${Math.floor(a / b)}`);
  }

  op_mod() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    if (b === 0) throw new Error('Modulo by zero');
    this.pushStack(a % b);
    this.addHistory('mod', `${a} % ${b} = ${a % b}`);
  }

  op_negate() {
    const a = this.toNumber(this.popStack());
    this.pushStack(-a);
    this.addHistory('negate', `Negate ${a} = ${-a}`);
  }

  op_abs() {
    const a = this.toNumber(this.popStack());
    this.pushStack(Math.abs(a));
    this.addHistory('abs', `Abs ${a} = ${Math.abs(a)}`);
  }

  op_not() {
    const a = this.toBool(this.popStack());
    this.pushStack(!a ? 1 : 0);
    this.addHistory('not', `Boolean NOT`);
  }

  op_0notequal() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a !== 0 ? 1 : 0);
    this.addHistory('0notEqual', `${a} != 0`);
  }

  op_1add() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a + 1);
    this.addHistory('1add', `${a} + 1 = ${a + 1}`);
  }

  op_1sub() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a - 1);
    this.addHistory('1sub', `${a} - 1 = ${a - 1}`);
  }

  op_min() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(Math.min(a, b));
    this.addHistory('min', `min(${a}, ${b}) = ${Math.min(a, b)}`);
  }

  op_max() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(Math.max(a, b));
    this.addHistory('max', `max(${a}, ${b}) = ${Math.max(a, b)}`);
  }

  op_within() {
    const max = this.toNumber(this.popStack());
    const min = this.toNumber(this.popStack());
    const x = this.toNumber(this.popStack());
    this.pushStack(x >= min && x < max ? 1 : 0);
    this.addHistory('within', `${x} within [${min}, ${max})`);
  }

  // Bitwise operations
  // Bitwise ops are bytewise in Bitcoin Script, and the two operands of
  // and/or/xor must be the same size.
  bitwisePair(name, combine) {
    const b = this.toHexString(this.popStack());
    const a = this.toHexString(this.popStack());
    if (a.length !== b.length) {
      throw new Error(`Cannot execute '${name}' - operands must be the same size (${a.length / 2} vs ${b.length / 2} bytes)`);
    }
    let out = '';
    for (let i = 0; i < a.length; i += 2) {
      const byte = combine(parseInt(a.substr(i, 2), 16), parseInt(b.substr(i, 2), 16));
      out += (byte & 0xff).toString(16).padStart(2, '0');
    }
    this.pushStack('0x' + out);
    this.addHistory(name, `0x${a} ${name} 0x${b} = 0x${out}`);
  }

  // Shift the whole byte string, keeping its length and filling with zeroes
  shiftHex(hex, bits, left) {
    if (bits < 0) throw new Error('Cannot shift by a negative number of bits');
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    const byteShift = Math.floor(bits / 8);
    const bitShift = bits % 8;
    const out = new Array(bytes.length).fill(0);

    for (let i = 0; i < bytes.length; i++) {
      const src = left ? i + byteShift : i - byteShift;
      if (src < 0 || src >= bytes.length) continue;
      let byte = left ? bytes[src] << bitShift : bytes[src] >> bitShift;
      if (bitShift) {
        const carry = left ? src + 1 : src - 1;
        if (carry >= 0 && carry < bytes.length) {
          byte |= left ? bytes[carry] >> (8 - bitShift) : bytes[carry] << (8 - bitShift);
        }
      }
      out[i] = byte & 0xff;
    }

    return out.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  op_and() {
    this.bitwisePair('and', (x, y) => x & y);
  }

  op_or() {
    this.bitwisePair('or', (x, y) => x | y);
  }

  op_xor() {
    this.bitwisePair('xor', (x, y) => x ^ y);
  }

  op_invert() {
    const hex = this.toHexString(this.popStack());
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      out += ((~parseInt(hex.substr(i, 2), 16)) & 0xff).toString(16).padStart(2, '0');
    }
    this.pushStack('0x' + out);
    this.addHistory('invert', `~0x${hex} = 0x${out}`);
  }

  op_lshift() {
    const n = this.toNumber(this.popStack());
    const hex = this.toHexString(this.popStack());
    const out = this.shiftHex(hex, n, true);
    this.pushStack('0x' + out);
    this.addHistory('lShift', `0x${hex} << ${n} = 0x${out}`);
  }

  op_rshift() {
    const n = this.toNumber(this.popStack());
    const hex = this.toHexString(this.popStack());
    const out = this.shiftHex(hex, n, false);
    this.pushStack('0x' + out);
    this.addHistory('rShift', `0x${hex} >> ${n} = 0x${out}`);
  }

  // Comparison operations
  op_equal() {
    const b = this.popStack();
    const a = this.popStack();
    const equal = this.toHexString(a).toLowerCase() === this.toHexString(b).toLowerCase();
    this.pushStack(equal ? 1 : 0);
    this.addHistory('equal', `${a} == ${b}`);
  }

  op_equalverify() {
    this.op_equal();
    this.op_verify();
  }

  op_lessthan() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a < b ? 1 : 0);
    this.addHistory('lessThan', `${a} < ${b}`);
  }

  op_greaterthan() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a > b ? 1 : 0);
    this.addHistory('greaterThan', `${a} > ${b}`);
  }

  op_lessthanorequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a <= b ? 1 : 0);
    this.addHistory('lessThanOrEqual', `${a} <= ${b}`);
  }

  op_greaterthanorequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a >= b ? 1 : 0);
    this.addHistory('greaterThanOrEqual', `${a} >= ${b}`);
  }

  op_numequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a === b ? 1 : 0);
    this.addHistory('numEqual', `${a} == ${b}`);
  }

  op_numequalverify() {
    this.op_numequal();
    this.op_verify();
  }

  op_numnotequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a !== b ? 1 : 0);
    this.addHistory('numNotEqual', `${a} != ${b}`);
  }

  // String operations (simplified implementations)
  op_cat() {
    const b = this.toHexString(this.popStack());
    const a = this.toHexString(this.popStack());
    this.pushStack('0x' + a + b);
    this.addHistory('cat', `Concatenate ${a.length / 2} + ${b.length / 2} bytes`);
  }

  op_split() {
    const position = this.toNumber(this.popStack());
    const hex = this.toHexString(this.popStack());
    if (position < 0 || position * 2 > hex.length) {
      throw new Error(`Cannot split at byte ${position} - item is ${hex.length / 2} bytes`);
    }
    this.pushStack('0x' + hex.substring(0, position * 2));
    this.pushStack('0x' + hex.substring(position * 2));
    this.addHistory('split', `Split at byte ${position}`);
  }

  // Little-endian, sign-magnitude byte encoding (Bitcoin Script number format)
  op_num2bin() {
    const size = this.toNumber(this.popStack());
    const num = this.toNumber(this.popStack());
    let value = Math.abs(num);
    const bytes = [];
    while (value > 0) {
      bytes.push(value % 256);
      value = Math.floor(value / 256);
    }
    if (bytes.length > size) {
      throw new Error(`Cannot fit ${num} into ${size} bytes`);
    }
    while (bytes.length < size) bytes.push(0);
    if (num < 0) bytes[size - 1] |= 0x80;
    const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    this.pushStack('0x' + hex);
    this.addHistory('num2bin', `Convert ${num} to ${size} bytes`);
  }

  op_bin2num() {
    const hex = this.toHexString(this.popStack());
    const num = this.hexToNum(hex);
    this.pushStack(num);
    this.addHistory('bin2num', `Convert ${hex.length / 2} bytes to ${num}`);
  }

  op_size() {
    const item = this.peekStack();
    const size = this.toHexString(item).length / 2;
    this.pushStack(size);
    this.addHistory('size', `Size: ${size} bytes`);
  }

  // Crypto operations using BSV SDK via IPC
  async op_ripemd160() {
    const data = this.popStack();
    const dataStr = typeof data === 'string' ? data : String(data);
    const hash = await window.bsv.ripemd160(dataStr);
    this.pushStack(hash);
    this.addHistory('ripemd160', `RIPEMD160 hash of "${dataStr}"`);
  }

  async op_sha1() {
    const data = this.popStack();
    const dataStr = typeof data === 'string' ? data : String(data);
    const hash = await window.bsv.sha1(dataStr);
    this.pushStack(hash);
    this.addHistory('sha1', `SHA1 hash of "${dataStr}"`);
  }

  async op_sha256() {
    const data = this.popStack();
    const dataStr = typeof data === 'string' ? data : String(data);
    const hash = await window.bsv.sha256(dataStr);
    this.pushStack(hash);
    this.addHistory('sha256', `SHA256 hash of "${dataStr}"`);
  }

  async op_hash160() {
    const data = this.popStack();
    const dataStr = typeof data === 'string' ? data : String(data);
    const hash = await window.bsv.hash160(dataStr);
    this.pushStack(hash);
    this.addHistory('hash160', `HASH160 (RIPEMD160(SHA256)) of "${dataStr}"`);
  }

  async op_hash256() {
    const data = this.popStack();
    const dataStr = typeof data === 'string' ? data : String(data);
    const hash = await window.bsv.hash256(dataStr);
    this.pushStack(hash);
    this.addHistory('hash256', `HASH256 (double SHA256) of "${dataStr}"`);
  }

  async op_checksig() {
    const pubKey = this.popStack();
    const signature = this.popStack();

    if (this.enableSignatures) {
      if (!this.txContext) {
        throw new Error('checkSig requires transaction context. Provide sighash or transaction details in Settings.');
      }

      const sigHex = this.toHexString(signature);
      const pubKeyHex = this.toHexString(pubKey);

      let sighash;
      if (this.txContextMode === 'sighash') {
        sighash = this.txContext.sighash;
      } else if (this.txContextMode === 'transaction') {
        const result = await window.bsv.computeSighash(
          this.txContext.txHex,
          this.txContext.inputIndex,
          this.txContext.prevScriptHex,
          this.txContext.satoshis,
          this.txContext.sighashType
        );
        if (!result.success) {
          throw new Error(`Failed to compute sighash: ${result.error}`);
        }
        sighash = result.sighash;
      }

      const result = await window.bsv.verifySig(sigHex, sighash, pubKeyHex);

      if (!result.success) {
        throw new Error(`checkSig error: ${result.error}`);
      }

      this.pushStack(result.valid ? 1 : 0);
      this.addHistory('checkSig', `Verify signature: ${result.valid ? 'VALID' : 'INVALID'}`);
    } else {
      // Simulated mode: always return true
      this.pushStack(1);
      this.addHistory('checkSig', 'Verify signature (simulated - always true)');
    }
  }

  async op_checksigverify() {
    await this.op_checksig();
    this.op_verify();
  }

  async op_checkmultisig() {
    const numPubKeys = this.toNumber(this.popStack());
    const pubKeys = [];
    for (let i = 0; i < numPubKeys; i++) {
      pubKeys.push(this.popStack());
    }
    const numSigs = this.toNumber(this.popStack());
    const sigs = [];
    for (let i = 0; i < numSigs; i++) {
      sigs.push(this.popStack());
    }
    this.popStack(); // Remove bug value (dummy element per Bitcoin protocol)

    if (this.enableSignatures) {
      if (!this.txContext) {
        throw new Error('checkMultiSig requires transaction context. Provide sighash or transaction details in Settings.');
      }

      const sigsHex = sigs.map(s => this.toHexString(s));
      const pubKeysHex = pubKeys.map(p => this.toHexString(p));

      let sighash;
      if (this.txContextMode === 'sighash') {
        sighash = this.txContext.sighash;
      } else if (this.txContextMode === 'transaction') {
        const result = await window.bsv.computeSighash(
          this.txContext.txHex,
          this.txContext.inputIndex,
          this.txContext.prevScriptHex,
          this.txContext.satoshis,
          this.txContext.sighashType
        );
        if (!result.success) {
          throw new Error(`Failed to compute sighash: ${result.error}`);
        }
        sighash = result.sighash;
      }

      const result = await window.bsv.verifyMultiSig(sigsHex, pubKeysHex, sighash);

      if (!result.success) {
        throw new Error(`checkMultiSig error: ${result.error}`);
      }

      this.pushStack(result.valid ? 1 : 0);
      this.addHistory('checkMultiSig', `Verify ${numSigs} of ${numPubKeys} multisig: ${result.valid ? 'VALID' : 'INVALID'}`);
    } else {
      this.pushStack(1); // Simplified: always return true
      this.addHistory('checkMultiSig', `Verify ${numSigs} of ${numPubKeys} signatures (simulated - always true)`);
    }
  }

  async op_checkmultisigverify() {
    await this.op_checkmultisig();
    this.op_verify();
  }

  async op_checkdatasig() {
    const pubKey = this.popStack();
    const message = this.popStack();
    const signature = this.popStack();

    if (this.enableSignatures) {
      // Convert values to hex strings
      const sigHex = this.toHexString(signature);
      const msgHex = this.toHexString(message);
      const pubKeyHex = this.toHexString(pubKey);

      const result = await window.bsv.verifyDataSig(sigHex, msgHex, pubKeyHex);

      if (!result.success) {
        throw new Error(`checkDataSig error: ${result.error}`);
      }

      this.pushStack(result.valid ? 1 : 0);
      this.addHistory('checkDataSig', `Verify data signature: ${result.valid ? 'VALID' : 'INVALID'}`);
    } else {
      this.pushStack(1); // Simplified: always return true
      this.addHistory('checkDataSig', 'Verify data signature (simulated - always true)');
    }
  }

  async op_checkdatasigverify() {
    await this.op_checkdatasig();
    this.op_verify();
  }
}

// Export for use in app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScriptInterpreter;
}
