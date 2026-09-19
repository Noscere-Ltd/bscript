/**
 * Monaco Editor Language Definition for Bitcoin Script
 * Defines syntax highlighting using Monarch
 */

const bitcoinScriptLanguageDef = {
  // Set defaultToken to invalid to see what you do not tokenize yet
  defaultToken: 'invalid',
  tokenPostfix: '.btc',

  keywords: [
    // Constants
    'false', 'true',

    // Flow control
    'nop', 'if', 'notIf', 'else', 'endIf', 'verify', 'return',

    // Stack operations
    'toAltStack', 'fromAltStack', 'ifDup', 'depth', 'drop', 'dup',
    'nip', 'over', 'pick', 'roll', 'rot', 'swap', 'tuck',
    '2drop', '2dup', '3dup', '2over', '2rot', '2swap',

    // Arithmetic
    'add', 'sub', 'mul', 'div', 'mod', 'negate', 'abs', 'not',
    '0notEqual', '1add', '1sub', '2mul', '2div', 'min', 'max', 'within',

    // Bitwise logic
    'and', 'or', 'xor', 'invert', 'lShift', 'rShift', 'lShiftNum', 'rShiftNum',

    // Comparison
    'equal', 'equalVerify', 'lessThan', 'greaterThan',
    'lessThanOrEqual', 'greaterThanOrEqual',
    'numEqual', 'numEqualVerify', 'numNotEqual',

    // String operations (BSV)
    'cat', 'split', 'num2bin', 'bin2num', 'size', 'substr', 'left', 'right',

    // Crypto
    'ripemd160', 'sha1', 'sha256', 'hash160', 'hash256',
    'checkSig', 'checkSigVerify', 'checkMultiSig', 'checkMultiSigVerify',

    // Additional opcodes
    'codeseparator', 'reserved', 'ver', 'verIf', 'verNotIf',
    'reserved1', 'reserved2',

    // Macros
    'hashCat', 'LOOP',
    'checkPreimage', 'codeSeparator',
    'extractVersion', 'extractHashPrevouts', 'extractHashSequence',
    'extractOutpoint', 'extractInputIndex',
    'extractAmount', 'extractSequence', 'extractOutputHash',
    'extractLocktime', 'extractSigHashType',

    // Import system
    'import', 'from',
  ],

  typeKeywords: [],

  operators: [],

  // Common regular expressions
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

  // The main tokenizer
  tokenizer: {
    root: [
      // Macro patterns
      [/xSwap_\d+/, 'keyword.macro'],
      [/xDrop_\d+/, 'keyword.macro'],
      [/xRot_\d+/, 'keyword.macro'],
      [/LOOP\[\d+\]\{[^}]+\}/, 'keyword.macro'],

      // Identifiers and keywords
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@typeKeywords': 'keyword.type',
          '@default': 'identifier'
        }
      }],

      // Whitespace
      { include: '@whitespace' },

      // Numbers
      [/(@digits)[eE]([\-+]?(@digits))?/, 'number.float'],
      [/(@digits)\.(@digits)([eE][\-+]?(@digits))?/, 'number.float'],
      [/0[xX](@hexdigits)/, 'number.hex'],
      [/0[oO]?(@octaldigits)/, 'number.octal'],
      [/0[bB](@binarydigits)/, 'number.binary'],
      [/(@digits)/, 'number'],

      // Delimiter: after number because of .\d floats
      [/[;,.]/, 'delimiter'],

      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-terminated string
      [/'([^'\\]|\\.)*$/, 'string.invalid'],  // non-terminated string
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\/.*$/, 'comment'],
    ],

    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop']
    ],

    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop']
    ],
  },
};

// Configuration for the language
const bitcoinScriptLanguageConfig = {
  comments: {
    lineComment: '//',
  },
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}']
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  folding: {
    markers: {
      start: new RegExp('^\\s*//\\s*#?region\\b'),
      end: new RegExp('^\\s*//\\s*#?endregion\\b')
    }
  }
};

// Theme definition
const bitcoinScriptTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'C586C0', fontStyle: 'bold' },
    { token: 'keyword.type', foreground: '4EC9B0' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'number.hex', foreground: 'B5CEA8' },
    { token: 'number.binary', foreground: 'B5CEA8' },
    { token: 'number.octal', foreground: 'B5CEA8' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'identifier', foreground: '9CDCFE' },
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#2d2d30',
    'editorCursor.foreground': '#aeafad',
    'editor.selectionBackground': '#264f78',
    'editor.inactiveSelectionBackground': '#3a3d41',
  }
};

// Register the language with Monaco
function registerBitcoinScriptLanguage(monaco) {
  // Register a new language
  monaco.languages.register({ id: 'bitcoinscript' });

  // Register a tokens provider for the language
  monaco.languages.setMonarchTokensProvider('bitcoinscript', bitcoinScriptLanguageDef);

  // Register a configuration provider for the language
  monaco.languages.setLanguageConfiguration('bitcoinscript', bitcoinScriptLanguageConfig);

  // Define a new theme
  monaco.editor.defineTheme('bitcoinscript-dark', bitcoinScriptTheme);
}

// Export for use in app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    registerBitcoinScriptLanguage,
    bitcoinScriptLanguageDef,
    bitcoinScriptLanguageConfig,
    bitcoinScriptTheme
  };
}
