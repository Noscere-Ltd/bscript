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
    this.lastCodeSeparator = null; // Instruction index of the last codeSeparator

    // Settings (preserved across resets)
    if (!this.enableSignatures) this.enableSignatures = false;
    if (!this.network) this.network = 'mainnet';
    if (!this.txVersion) this.txVersion = 1;
    // The opcode tests and the differential harness drive the script to the
    // end and read the stack, the same way Spend.step() is used without
    // Spend.validate(). They turn this off; the app never does.
    if (this.applyFinalRules === undefined) this.applyFinalRules = true;

    // Transaction context for signature verification (preserved across resets)
    if (!this.txContext) this.txContext = null;
    if (!this.txContextMode) this.txContextMode = null;
  }

  // Version 2 and above relax the strict rules, the same test Spend makes
  isRelaxed() {
    return this.txVersion > 1;
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
  // minimally encoded, with zero as no bytes at all.
  //
  // Script numbers are arbitrary width, so they are BigInt here. A double
  // loses whole satoshis above 2^53, and an amount read out of a preimage is
  // exactly the kind of number that goes past it.
  numToHex(value) {
    const num = BigInt(value);
    let magnitude = num < 0n ? -num : num;
    const bytes = [];
    while (magnitude > 0n) {
      bytes.push(Number(magnitude % 256n));
      magnitude /= 256n;
    }
    if (bytes.length === 0) return '';
    if (bytes[bytes.length - 1] & 0x80) {
      bytes.push(num < 0n ? 0x80 : 0x00);
    } else if (num < 0n) {
      bytes[bytes.length - 1] |= 0x80;
    }
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Decode little-endian sign-magnitude bytes back to a number
  hexToNum(hex) {
    const byteCount = Math.floor(hex.length / 2);
    let num = 0n;
    let negative = false;
    for (let i = byteCount - 1; i >= 0; i--) {
      let byte = parseInt(hex.substr(i * 2, 2), 16);
      if (i === byteCount - 1 && (byte & 0x80)) {
        negative = true;
        byte &= 0x7f;
      }
      num = num * 256n + BigInt(byte);
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
    if (typeof value === 'bigint' || typeof value === 'number') {
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
    expanded = expanded.replace(/\bxSwap_(\d+)\b/g, (match, n) => {
      const depth = parseInt(n);
      if (depth === 0 || depth === 1) return 'swap'; // xSwap_1 is just swap

      // xSwap_n: roll n items to bring nth to top, swap, then roll back
      const rollForward = depth.toString();
      const rollBack = (depth - 1).toString();
      return `${rollForward} roll swap ${rollBack} roll`;
    });

    // Expand xDrop macros: xDrop_n (drop nth item)
    expanded = expanded.replace(/\bxDrop_(\d+)\b/g, (match, n) => {
      const depth = parseInt(n);
      if (depth === 0) return 'drop'; // xDrop_0 is just drop

      // xDrop_n: roll n items to bring nth to top, drop, then reverse remaining
      const rollForward = depth.toString();
      return `${rollForward} roll drop`;
    });

    // Expand xRot macros: xRot_n (rotate nth item to top)
    expanded = expanded.replace(/\bxRot_(\d+)\b/g, (match, n) => {
      const depth = parseInt(n);
      if (depth === 0 || depth === 1) return ''; // xRot_0/1 is nop

      // xRot_n: roll n items to bring nth to top
      return `${depth} roll`;
    });

    // Expand hashCat macro: duplicates, hashes, concatenates
    expanded = expanded.replace(/\bhashCat\b/g, () => {
      return 'dup sha256 swap cat';
    });

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
      // Numbers handed in from outside become script numbers like any other
      this.mainStack = initialStack.map(
        (item) => (typeof item === 'number' ? BigInt(Math.trunc(item)) : item));
    }

    // Resolve imports first
    const importResolved = await this.resolveImports(scriptText, currentFilePath);

    // Comments come out before macros expand. A name mentioned in a comment
    // is not code, and replacing it there put whole macro bodies into the
    // token stream.
    const withoutComments = importResolved.split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    // Expand macros before tokenization
    const expandedScript = this.expandMacros(withoutComments);

    const lines = expandedScript.split('\n');
    const tokens = [];
    const tokenLines = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex].trim();
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

      if (this.applyFinalRules) this.checkFinalStack();

      this.status = 'success';
      return { success: true, stack: this.mainStack };
    } catch (error) {
      this.status = 'error';
      this.error = error.message;
      return { success: false, error: error.message };
    }
  }

  // The verdict Spend.validate() reaches once the script has run: something
  // must be left, it must be true, and under the strict rules it must be the
  // only thing left.
  checkFinalStack() {
    if (this.mainStack.length === 0) {
      throw new Error('Script failed: the stack is empty at the end of the script');
    }
    if (!this.isRelaxed() && this.mainStack.length !== 1) {
      throw new Error(`Script failed: ${this.mainStack.length} items left on the stack, ` +
        'and version 1 requires exactly one (clean stack)');
    }
    if (!this.toBool(this.mainStack[this.mainStack.length - 1])) {
      throw new Error('Script failed: the top stack item is false');
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
      if (this.applyFinalRules) {
        try {
          this.checkFinalStack();
        } catch (error) {
          this.status = 'error';
          this.error = error.message;
          throw error;
        }
      }
      this.status = 'success';
      return false;
    }

    const instruction = this.instructions[this.ip];
    this.skipIPIncrement = false; // Reset flag before executing instruction

    // Inside a branch that was not taken, only the conditionals themselves run
    if (!this.branchExecuting() &&
        !['if', 'notIf', 'verIf', 'verNotIf', 'else', 'endIf'].includes(instruction)) {
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
    return BigInt(token);
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
      'lShiftNum': () => this.op_lshiftnum(),
      'rShiftNum': () => this.op_rshiftnum(),

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
      'booland': () => this.op_booland(),
      'boolor': () => this.op_boolor(),

      // String operations (BSV restored)
      'cat': () => this.op_cat(),
      'split': () => this.op_split(),
      'num2bin': () => this.op_num2bin(),
      'substr': () => this.op_substr(),
      'left': () => this.op_left(),
      'right': () => this.op_right(),
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
      'checkPreimage': async () => await this.op_checkpreimage(),

      // Restored by the Genesis upgrade
      'ver': () => this.op_ver(),
      'verIf': () => this.op_verif(),
      'verNotIf': () => this.op_vernotif(),
      '2mul': () => this.op_2mul(),
      '2div': () => this.op_2div(),
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

  // Convert stack value to a script number, which is a BigInt
  toNumber(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.trunc(value));
    if (typeof value === 'boolean') return value ? 1n : 0n;
    if (typeof value === 'string') {
      if (this.isHexValue(value)) {
        const hex = value.slice(2);
        if (!this.isRelaxed()) this.requireMinimalNumber(hex);
        return this.hexToNum(hex);
      }
      if (/^-?\d+$/.test(value.trim())) return BigInt(value.trim());
    }
    throw new Error(`Cannot convert '${value}' to a number`);
  }

  // A stack value used as a position, a width or a count. These index
  // JavaScript arrays and strings, so they come back as a Number.
  toIndex(value) {
    return Number(this.toNumber(value));
  }

  // Under the strict rules a number may not carry a byte it does not need:
  // the last byte can only be 0x00 or 0x80 when the byte before it needs the
  // sign bit. Empty is zero. Mirrors BigNumber.fromScriptNum(_, true).
  requireMinimalNumber(hex) {
    const byteCount = hex.length / 2;
    if (byteCount === 0) return;
    if ((parseInt(hex.slice(-2), 16) & 0x7f) !== 0) return;
    if (byteCount > 1 && (parseInt(hex.slice(-4, -2), 16) & 0x80) !== 0) return;
    throw new Error('non-minimally encoded script number');
  }

  // Convert stack value to boolean. Bytes are false when every byte is zero,
  // where a lone sign bit in the last byte still counts as zero.
  toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value !== 0n;
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
    this.pushStack(0n);
    this.addHistory('false', 'Push 0');
  }

  op_true() {
    this.pushStack(1n);
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
    this.lastCodeSeparator = this.ip;
    this.addHistory('codeSeparator',
      'Signatures from here on cover only the script after this point');
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
    this.pushStack(BigInt(this.mainStack.length));
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
    const n = this.toIndex(this.popStack());
    if (n < 0 || n >= this.mainStack.length) {
      throw new Error('Invalid pick depth');
    }
    const value = this.peekStack(n);
    this.pushStack(value);
    this.addHistory('pick', `Copy item at depth ${n}`);
  }

  op_roll() {
    const n = this.toIndex(this.popStack());
    if (n < 0 || n >= this.mainStack.length) {
      throw new Error('Invalid roll depth');
    }
    const value = this.mainStack.splice(this.mainStack.length - 1 - n, 1)[0];
    this.pushStack(value);
    this.addHistory('roll', `Move item at depth ${n} to top`);
  }

  // The transaction version as the 4 little-endian bytes the node compares
  versionHex() {
    const v = this.txVersion;
    return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  op_ver() {
    const hex = this.versionHex();
    this.pushStack('0x' + hex);
    this.addHistory('ver', `Push transaction version ${this.txVersion} as 0x${hex}`);
  }

  // verIf and verNotIf branch on the transaction version rather than on
  // truthiness, and only an item of exactly four bytes can match it.
  openVersionBranch(opcode, invert) {
    let taken = false;
    if (this.branchExecuting()) {
      if (this.mainStack.length < 1) {
        throw new Error(`Cannot execute '${opcode}' - the stack is empty`);
      }
      const hex = this.toHexString(this.popStack());
      taken = hex.length === 8 && hex.toLowerCase() === this.versionHex();
      if (invert) taken = !taken;
    }
    this.condStack.push(taken);
    this.addHistory(opcode, `Conditional branch: ${taken}`);
  }

  op_verif() {
    this.openVersionBranch('verIf', false);
  }

  op_vernotif() {
    this.openVersionBranch('verNotIf', true);
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
    if (b === 0n) throw new Error('Division by zero');
    this.pushStack(a / b);
    this.addHistory('div', `${a} / ${b} = ${a / b}`);
  }

  op_mod() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    if (b === 0n) throw new Error('Modulo by zero');
    this.pushStack(a % b);
    this.addHistory('mod', `${a} % ${b} = ${a % b}`);
  }

  op_2mul() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a * 2n);
    this.addHistory('2mul', `${a} * 2 = ${a * 2n}`);
  }

  op_2div() {
    const a = this.toNumber(this.popStack());
    const result = a / 2n;
    this.pushStack(result);
    this.addHistory('2div', `${a} / 2 = ${result}`);
  }

  op_negate() {
    const a = this.toNumber(this.popStack());
    this.pushStack(-a);
    this.addHistory('negate', `Negate ${a} = ${-a}`);
  }

  op_abs() {
    const a = this.toNumber(this.popStack());
    const result = a < 0n ? -a : a;
    this.pushStack(result);
    this.addHistory('abs', `Abs ${a} = ${result}`);
  }

  op_not() {
    // Numeric in the SDK, not a truthiness test, so it decodes like 0notEqual
    const a = this.toNumber(this.popStack());
    this.pushStack(a === 0n ? 1n : 0n);
    this.addHistory('not', `Boolean NOT`);
  }

  op_0notequal() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a !== 0n ? 1n : 0n);
    this.addHistory('0notEqual', `${a} != 0`);
  }

  op_1add() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a + 1n);
    this.addHistory('1add', `${a} + 1 = ${a + 1n}`);
  }

  op_1sub() {
    const a = this.toNumber(this.popStack());
    this.pushStack(a - 1n);
    this.addHistory('1sub', `${a} - 1 = ${a - 1n}`);
  }

  op_min() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    const result = a < b ? a : b;
    this.pushStack(result);
    this.addHistory('min', `min(${a}, ${b}) = ${result}`);
  }

  op_max() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    const result = a > b ? a : b;
    this.pushStack(result);
    this.addHistory('max', `max(${a}, ${b}) = ${result}`);
  }

  op_within() {
    const max = this.toNumber(this.popStack());
    const min = this.toNumber(this.popStack());
    const x = this.toNumber(this.popStack());
    this.pushStack(x >= min && x < max ? 1n : 0n);
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
    const n = this.toIndex(this.popStack());
    const hex = this.toHexString(this.popStack());
    const out = this.shiftHex(hex, n, true);
    this.pushStack('0x' + out);
    this.addHistory('lShift', `0x${hex} << ${n} = 0x${out}`);
  }

  op_rshift() {
    const n = this.toIndex(this.popStack());
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
    this.pushStack(equal ? 1n : 0n);
    this.addHistory('equal', `${a} == ${b}`);
  }

  op_equalverify() {
    this.op_equal();
    this.op_verify();
  }

  op_lessthan() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a < b ? 1n : 0n);
    this.addHistory('lessThan', `${a} < ${b}`);
  }

  op_greaterthan() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a > b ? 1n : 0n);
    this.addHistory('greaterThan', `${a} > ${b}`);
  }

  op_lessthanorequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a <= b ? 1n : 0n);
    this.addHistory('lessThanOrEqual', `${a} <= ${b}`);
  }

  op_greaterthanorequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a >= b ? 1n : 0n);
    this.addHistory('greaterThanOrEqual', `${a} >= ${b}`);
  }

  op_booland() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a !== 0n && b !== 0n ? 1n : 0n);
    this.addHistory('booland', `${a} && ${b}`);
  }

  op_boolor() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a !== 0n || b !== 0n ? 1n : 0n);
    this.addHistory('boolor', `${a} || ${b}`);
  }

  op_numequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a === b ? 1n : 0n);
    this.addHistory('numEqual', `${a} == ${b}`);
  }

  op_numequalverify() {
    this.op_numequal();
    this.op_verify();
  }

  op_numnotequal() {
    const b = this.toNumber(this.popStack());
    const a = this.toNumber(this.popStack());
    this.pushStack(a !== b ? 1n : 0n);
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
    const position = this.toIndex(this.popStack());
    const hex = this.toHexString(this.popStack());
    if (position < 0 || position * 2 > hex.length) {
      throw new Error(`Cannot split at byte ${position} - item is ${hex.length / 2} bytes`);
    }
    this.pushStack('0x' + hex.substring(0, position * 2));
    this.pushStack('0x' + hex.substring(position * 2));
    this.addHistory('split', `Split at byte ${position}`);
  }

  op_substr() {
    const length = this.toIndex(this.popStack());
    const offset = this.toIndex(this.popStack());
    const hex = this.toHexString(this.popStack());
    const size = hex.length / 2;
    if (offset < 0 || offset >= size || length < 0 || length > size - offset) {
      throw new Error(`substr offset (${offset}) must be in [0, ${size}) and ` +
        `length (${length}) in [0, ${size - offset}]`);
    }
    this.pushStack('0x' + hex.substring(offset * 2, (offset + length) * 2));
    this.addHistory('substr', `Bytes ${offset} to ${offset + length}`);
  }

  op_left() {
    const length = this.toIndex(this.popStack());
    const hex = this.toHexString(this.popStack());
    const size = hex.length / 2;
    if (length < 0 || length > size) {
      throw new Error(`left length (${length}) must be in [0, ${size}]`);
    }
    this.pushStack('0x' + hex.substring(0, length * 2));
    this.addHistory('left', `Leftmost ${length} bytes`);
  }

  op_right() {
    const length = this.toIndex(this.popStack());
    const hex = this.toHexString(this.popStack());
    const size = hex.length / 2;
    if (length < 0 || length > size) {
      throw new Error(`right length (${length}) must be in [0, ${size}]`);
    }
    this.pushStack('0x' + hex.substring((size - length) * 2));
    this.addHistory('right', `Rightmost ${length} bytes`);
  }

  // lShiftNum and rShiftNum shift the number, where lShift and rShift shift
  // the bytes. rShiftNum truncates toward zero, so it is not a floor shift.
  op_lshiftnum() {
    const bits = this.toIndex(this.popStack());
    if (bits < 0) throw new Error('lShiftNum bits to shift must not be negative');
    const value = this.toNumber(this.popStack());
    const result = value << BigInt(bits);
    this.pushStack(result);
    this.addHistory('lShiftNum', `${value} << ${bits} = ${result}`);
  }

  op_rshiftnum() {
    const bits = this.toIndex(this.popStack());
    if (bits < 0) throw new Error('rShiftNum bits to shift must not be negative');
    const value = this.toNumber(this.popStack());
    // Truncation toward zero, which is not what >> does to a negative number
    const magnitude = (value < 0n ? -value : value) >> BigInt(bits);
    const result = value < 0n ? -magnitude : magnitude;
    this.pushStack(result);
    this.addHistory('rShiftNum', `${value} >> ${bits} = ${result}`);
  }

  // Little-endian, sign-magnitude byte encoding (Bitcoin Script number format)
  op_num2bin() {
    const size = this.toIndex(this.popStack());
    if (size < 0 || size > ScriptInterpreter.MAX_ELEMENT_SIZE) {
      throw new Error(`num2bin cannot produce ${size} bytes`);
    }

    // The operand is taken as bytes, so num2bin can pad data as well as a
    // number. Strip it to its minimal form first: padding a value that
    // already uses the top bit of its last byte would silently negate it.
    const bytes = this.minimallyEncodeBytes(this.hexToBytes(this.toHexString(this.popStack())));
    if (bytes.length > size) {
      throw new Error(`Cannot fit 0x${this.bytesToHexString(bytes)} into ${size} bytes`);
    }

    let result = bytes;
    if (bytes.length !== size) {
      result = new Array(size).fill(0);
      const signBit = bytes.length > 0 ? bytes[bytes.length - 1] & 0x80 : 0;
      if (bytes.length > 0) bytes[bytes.length - 1] &= 0x7f;
      for (let i = 0; i < bytes.length; i++) result[i] = bytes[i];
      if (signBit !== 0) result[size - 1] |= 0x80;
    }

    const hex = this.bytesToHexString(result);
    this.pushStack('0x' + hex);
    this.addHistory('num2bin', `Convert to ${size} bytes: 0x${hex}`);
  }

  hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    return bytes;
  }

  bytesToHexString(bytes) {
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Drop the bytes a script number does not need, keeping its sign. Mirrors
  // minimallyEncode in @bsv/sdk.
  minimallyEncodeBytes(bytes) {
    if (bytes.length === 0) return bytes;
    const last = bytes[bytes.length - 1];
    if ((last & 0x7f) !== 0) return bytes;
    if (bytes.length === 1) return [];
    if ((bytes[bytes.length - 2] & 0x80) !== 0) return bytes;

    for (let i = bytes.length - 1; i > 0; i--) {
      if (bytes[i - 1] !== 0) {
        if ((bytes[i - 1] & 0x80) !== 0) {
          bytes[i] = last;
          return bytes.slice(0, i + 1);
        }
        bytes[i - 1] |= last;
        return bytes.slice(0, i);
      }
    }
    return [];
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
    this.pushStack(BigInt(size));
    this.addHistory('size', `Size: ${size} bytes`);
  }

  // Crypto operations using BSV SDK via IPC.
  //
  // The stack item is bytes, so it goes to the handler as 0x-prefixed hex and
  // the digest comes back prefixed too. Passing String(item) hashed the number
  // 5 as the text "5".
  async hashOp(name, label) {
    const hex = this.toHexString(this.popStack());
    const hash = await window.bsv[name]('0x' + hex);
    this.pushStack('0x' + hash);
    this.addHistory(name, `${label} of 0x${hex}`);
  }

  async op_ripemd160() {
    await this.hashOp('ripemd160', 'RIPEMD160 hash');
  }

  async op_sha1() {
    await this.hashOp('sha1', 'SHA1 hash');
  }

  async op_sha256() {
    await this.hashOp('sha256', 'SHA256 hash');
  }

  async op_hash160() {
    await this.hashOp('hash160', 'HASH160 (RIPEMD160(SHA256))');
  }

  async op_hash256() {
    await this.hashOp('hash256', 'HASH256 (double SHA256)');
  }

  async op_checksig() {
    const pubKey = this.popStack();
    const signature = this.popStack();

    if (this.enableSignatures) {
      if (!this.txContext) {
        throw new Error('checkSig requires transaction context. Provide sighash or transaction details in Settings.');
      }

      const result = await window.bsv.verifySig(this.signatureCheckParams(
        this.toHexString(signature), this.toHexString(pubKey)
      ));

      if (!result.success) {
        throw new Error(`checkSig error: ${result.error}`);
      }

      this.pushStack(result.valid ? 1n : 0n);
      this.addHistory('checkSig', `Verify signature: ${result.valid ? 'VALID' : 'INVALID'}`);
    } else {
      // Simulated mode: any signature passes except the empty one, which is
      // how a script says "no signature here" and never verifies
      const valid = this.toHexString(signature).length > 0;
      this.pushStack(valid ? 1n : 0n);
      this.addHistory('checkSig', valid
        ? 'Verify signature (simulated - always true)'
        : 'Empty signature is false even in simulated mode');
    }
  }

  // What the main process needs to check a signature. In transaction mode the
  // sighash is computed there, under the scope the signature itself carries.
  signatureCheckParams(signatureHex, pubKeyHex) {
    const params = { signatureHex, pubKeyHex, requireLowS: !this.isRelaxed() };

    if (this.txContextMode === 'sighash') {
      params.sighashHex = this.txContext.sighash;
    } else {
      params.txContext = {
        txHex: this.txContext.txHex,
        inputIndex: this.txContext.inputIndex,
        prevScriptHex: this.txContext.prevScriptHex,
        satoshis: this.txContext.satoshis
      };

      // A signature made after a codeSeparator covers only the script that
      // follows it. ponytail: the SDK also deletes the signature itself from
      // the subscript; a locking script that embeds its own signature is not
      // something this simulator can produce.
      if (this.lastCodeSeparator !== null) {
        params.txContext.subscriptHex = compileInstructionsToHex(
          this.instructions.slice(this.lastCodeSeparator + 1));
      }
    }

    return params;
  }

  async op_checksigverify() {
    await this.op_checksig();
    this.op_verify();
  }

  async op_checkmultisig() {
    const numPubKeys = this.toIndex(this.popStack());
    const pubKeys = [];
    for (let i = 0; i < numPubKeys; i++) {
      pubKeys.push(this.popStack());
    }
    const numSigs = this.toIndex(this.popStack());
    const sigs = [];
    for (let i = 0; i < numSigs; i++) {
      sigs.push(this.popStack());
    }

    // The dummy element the original implementation pops. Under the strict
    // rules it has to be empty (NULLDUMMY).
    const dummy = this.popStack();
    if (!this.isRelaxed() && this.toHexString(dummy).length > 0) {
      throw new Error('checkMultiSig requires the dummy element to be empty');
    }

    if (this.enableSignatures) {
      if (!this.txContext) {
        throw new Error('checkMultiSig requires transaction context. Provide sighash or transaction details in Settings.');
      }

      const params = this.signatureCheckParams(null, null);
      delete params.signatureHex;
      delete params.pubKeyHex;
      params.signaturesHex = sigs.map(s => this.toHexString(s));
      params.pubKeysHex = pubKeys.map(p => this.toHexString(p));

      const result = await window.bsv.verifyMultiSig(params);

      if (!result.success) {
        throw new Error(`checkMultiSig error: ${result.error}`);
      }

      this.pushStack(result.valid ? 1n : 0n);
      this.addHistory('checkMultiSig', `Verify ${numSigs} of ${numPubKeys} multisig: ${result.valid ? 'VALID' : 'INVALID'}`);
    } else {
      const valid = sigs.every(sig => this.toHexString(sig).length > 0);
      this.pushStack(valid ? 1n : 0n);
      this.addHistory('checkMultiSig', valid
        ? `Verify ${numSigs} of ${numPubKeys} signatures (simulated - always true)`
        : 'An empty signature is false even in simulated mode');
    }
  }

  // checkPreimage is not a single opcode. The compiler emits the OP_PUSH_TX
  // binding for it: 428 bytes that derive a signature from hash256(preimage)
  // in script and check it with OP_CHECKSIGVERIFY, so the preimage on the
  // stack has to be the one the node is signing. The simulator runs it as one
  // step and checks the same thing directly. The binding consumes nothing and
  // leaves the preimage where it found it.
  async op_checkpreimage() {
    if (this.mainStack.length < 1) {
      throw new Error('checkPreimage requires the preimage on the stack');
    }

    const preimageHex = this.toHexString(this.mainStack[this.mainStack.length - 1]);

    if (this.txContextMode !== 'transaction') {
      this.addHistory('checkPreimage', 'Preimage NOT verified: no transaction context');
      console.warn('checkPreimage: no transaction context, so the preimage was not verified. ' +
        'On chain the binding would reject a preimage that does not match the spending transaction.');
      return;
    }

    // The binding pins the sighash type to ALL|FORKID, so the signed message
    // is always BIP-143 over the whole locking script being spent.
    const result = await window.bsv.computeSighash(
      this.txContext.txHex,
      this.txContext.inputIndex,
      this.txContext.prevScriptHex,
      this.txContext.satoshis,
      ScriptInterpreter.SIGHASH_ALL_FORKID
    );
    if (!result.success) {
      throw new Error(`checkPreimage: failed to compute sighash: ${result.error}`);
    }

    const actual = (await window.bsv.hash256('0x' + preimageHex)).toLowerCase();
    const expected = result.sighash.toLowerCase();
    if (actual !== expected) {
      throw new Error(
        `checkPreimage failed: the preimage on the stack hashes to ${actual}, ` +
        `but the transaction being spent signs ${expected}`
      );
    }

    this.addHistory('checkPreimage', 'Preimage matches the transaction being spent');
  }

  async op_checkmultisigverify() {
    await this.op_checkmultisig();
    this.op_verify();
  }

}

// SIGHASH_ALL | SIGHASH_FORKID, the type the OP_PUSH_TX binding pins
ScriptInterpreter.SIGHASH_ALL_FORKID = 0x41;
ScriptInterpreter.MAX_ELEMENT_SIZE = 520;

// Export for use in app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScriptInterpreter;
}
