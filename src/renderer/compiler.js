/* compiler.js - Bitcoin Script compiler and disassembler (renderer global) */

const OPCODE_MAP = {
  'false': 0x00, '0': 0x00,
  'true': 0x51, '1': 0x51,
  'nop': 0x61,
  'ver': 0x62, 'verIf': 0x65, 'verNotIf': 0x66,
  'if': 0x63, 'notIf': 0x64, 'else': 0x67, 'endIf': 0x68,
  'verify': 0x69, 'return': 0x6a,
  'toAltStack': 0x6b, 'fromAltStack': 0x6c,
  '2drop': 0x6d, '2dup': 0x6e, '3dup': 0x6f,
  '2over': 0x70, '2rot': 0x71, '2swap': 0x72,
  'ifDup': 0x73, 'depth': 0x74, 'drop': 0x75, 'dup': 0x76,
  'nip': 0x77, 'over': 0x78, 'pick': 0x79, 'roll': 0x7a,
  'rot': 0x7b, 'swap': 0x7c, 'tuck': 0x7d,
  'cat': 0x7e, 'split': 0x7f, 'num2bin': 0x80, 'bin2num': 0x81, 'size': 0x82,
  'invert': 0x83, 'and': 0x84, 'or': 0x85, 'xor': 0x86,
  'equal': 0x87, 'equalVerify': 0x88,
  '1add': 0x8b, '1sub': 0x8c, '2mul': 0x8d, '2div': 0x8e,
  'negate': 0x8f, 'abs': 0x90, 'not': 0x91, '0notEqual': 0x92,
  'add': 0x93, 'sub': 0x94, 'mul': 0x95, 'div': 0x96, 'mod': 0x97,
  'lShift': 0x98, 'rShift': 0x99,
  'booland': 0x9a, 'boolor': 0x9b,
  'numEqual': 0x9c, 'numEqualVerify': 0x9d, 'numNotEqual': 0x9e,
  'lessThan': 0x9f, 'greaterThan': 0xa0,
  'lessThanOrEqual': 0xa1, 'greaterThanOrEqual': 0xa2,
  'min': 0xa3, 'max': 0xa4, 'within': 0xa5,
  'ripemd160': 0xa6, 'sha1': 0xa7, 'sha256': 0xa8,
  'hash160': 0xa9, 'hash256': 0xaa,
  'substr': 0xb3, 'left': 0xb4, 'right': 0xb5,
  'lShiftNum': 0xb6, 'rShiftNum': 0xb7,
  'checkSig': 0xac, 'checkSigVerify': 0xad,
  'checkMultiSig': 0xae, 'checkMultiSigVerify': 0xaf,
  'codeSeparator': 0xab,
};

var OPCODE_NAMES = (function() {
  var map = {};
  map[0x00] = 'OP_0';
  map[0x51] = 'OP_1';
  map[0x61] = 'OP_NOP';
  map[0x62] = 'OP_VER';
  map[0x65] = 'OP_VERIF';
  map[0x66] = 'OP_VERNOTIF';
  map[0x63] = 'OP_IF';
  map[0x64] = 'OP_NOTIF';
  map[0x67] = 'OP_ELSE';
  map[0x68] = 'OP_ENDIF';
  map[0x69] = 'OP_VERIFY';
  map[0x6a] = 'OP_RETURN';
  map[0x6b] = 'OP_TOALTSTACK';
  map[0x6c] = 'OP_FROMALTSTACK';
  map[0x6d] = 'OP_2DROP';
  map[0x6e] = 'OP_2DUP';
  map[0x6f] = 'OP_3DUP';
  map[0x70] = 'OP_2OVER';
  map[0x71] = 'OP_2ROT';
  map[0x72] = 'OP_2SWAP';
  map[0x73] = 'OP_IFDUP';
  map[0x74] = 'OP_DEPTH';
  map[0x75] = 'OP_DROP';
  map[0x76] = 'OP_DUP';
  map[0x77] = 'OP_NIP';
  map[0x78] = 'OP_OVER';
  map[0x79] = 'OP_PICK';
  map[0x7a] = 'OP_ROLL';
  map[0x7b] = 'OP_ROT';
  map[0x7c] = 'OP_SWAP';
  map[0x7d] = 'OP_TUCK';
  map[0x7e] = 'OP_CAT';
  map[0x7f] = 'OP_SPLIT';
  map[0x80] = 'OP_NUM2BIN';
  map[0x81] = 'OP_BIN2NUM';
  map[0x82] = 'OP_SIZE';
  map[0x83] = 'OP_INVERT';
  map[0x84] = 'OP_AND';
  map[0x85] = 'OP_OR';
  map[0x86] = 'OP_XOR';
  map[0x87] = 'OP_EQUAL';
  map[0x88] = 'OP_EQUALVERIFY';
  map[0x8b] = 'OP_1ADD';
  map[0x8c] = 'OP_1SUB';
  map[0x8d] = 'OP_2MUL';
  map[0x8e] = 'OP_2DIV';
  map[0x8f] = 'OP_NEGATE';
  map[0x90] = 'OP_ABS';
  map[0x91] = 'OP_NOT';
  map[0x92] = 'OP_0NOTEQUAL';
  map[0x93] = 'OP_ADD';
  map[0x94] = 'OP_SUB';
  map[0x95] = 'OP_MUL';
  map[0x96] = 'OP_DIV';
  map[0x97] = 'OP_MOD';
  map[0x98] = 'OP_LSHIFT';
  map[0x99] = 'OP_RSHIFT';
  map[0x9a] = 'OP_BOOLAND';
  map[0x9b] = 'OP_BOOLOR';
  map[0x9c] = 'OP_NUMEQUAL';
  map[0x9d] = 'OP_NUMEQUALVERIFY';
  map[0x9e] = 'OP_NUMNOTEQUAL';
  map[0x9f] = 'OP_LESSTHAN';
  map[0xa0] = 'OP_GREATERTHAN';
  map[0xa1] = 'OP_LESSTHANOREQUAL';
  map[0xa2] = 'OP_GREATERTHANOREQUAL';
  map[0xa3] = 'OP_MIN';
  map[0xa4] = 'OP_MAX';
  map[0xa5] = 'OP_WITHIN';
  map[0xa6] = 'OP_RIPEMD160';
  map[0xa7] = 'OP_SHA1';
  map[0xa8] = 'OP_SHA256';
  map[0xa9] = 'OP_HASH160';
  map[0xaa] = 'OP_HASH256';
  map[0xac] = 'OP_CHECKSIG';
  map[0xad] = 'OP_CHECKSIGVERIFY';
  map[0xae] = 'OP_CHECKMULTISIG';
  map[0xaf] = 'OP_CHECKMULTISIGVERIFY';
  map[0xab] = 'OP_CODESEPARATOR';
  map[0xb3] = 'OP_SUBSTR';
  map[0xb4] = 'OP_LEFT';
  map[0xb5] = 'OP_RIGHT';
  map[0xb6] = 'OP_LSHIFTNUM';
  map[0xb7] = 'OP_RSHIFTNUM';
  // OP_N for 2-16
  map[0x52] = 'OP_2';
  map[0x53] = 'OP_3';
  map[0x54] = 'OP_4';
  map[0x55] = 'OP_5';
  map[0x56] = 'OP_6';
  map[0x57] = 'OP_7';
  map[0x58] = 'OP_8';
  map[0x59] = 'OP_9';
  map[0x5a] = 'OP_10';
  map[0x5b] = 'OP_11';
  map[0x5c] = 'OP_12';
  map[0x5d] = 'OP_13';
  map[0x5e] = 'OP_14';
  map[0x5f] = 'OP_15';
  map[0x60] = 'OP_16';
  map[0x4f] = 'OP_1NEGATE';
  map[0x4c] = 'OP_PUSHDATA1';
  map[0x4d] = 'OP_PUSHDATA2';
  return map;
})();

function encodeScriptNumber(n) {
  if (n === 0n) return new Uint8Array(0);
  var negative = n < 0n;
  var abs = negative ? -n : n;
  var bytes = [];
  while (abs > 0n) {
    bytes.push(Number(abs & 0xffn));
    abs >>= 8n;
  }
  var last = bytes[bytes.length - 1];
  if (last & 0x80) {
    bytes.push(negative ? 0x80 : 0x00);
  } else if (negative) {
    bytes[bytes.length - 1] = last | 0x80;
  }
  return new Uint8Array(bytes);
}

function decodeScriptNumber(bytes) {
  if (bytes.length === 0) return 0n;
  var result = 0n;
  for (var i = 0; i < bytes.length; i++) {
    result |= BigInt(bytes[i]) << BigInt(8 * i);
  }
  var lastByte = bytes[bytes.length - 1];
  if (lastByte & 0x80) {
    result &= ~(0x80n << BigInt(8 * (bytes.length - 1)));
    result = -result;
  }
  return result;
}

function hexToBytes(hex) {
  // parseInt reads '2g' as 2 and 'zz' as NaN, which the array stores as 0, so
  // a typo compiled to different bytes and Deploy would broadcast them
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error('Not valid hex (digits 0-9 and a-f, in pairs): ' +
      (hex.length > 40 ? hex.substring(0, 40) + '...' : hex));
  }
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return hex;
}


function compileInstructionsToHex(instructions) {
  var output = [];

  for (var idx = 0; idx < instructions.length; idx++) {
    var token = instructions[idx];

    if (OPCODE_MAP.hasOwnProperty(token)) {
      output.push(OPCODE_MAP[token]);
      continue;
    }

    // checkPreimage is not an opcode: it compiles to the vendored OP_PUSH_TX
    // binding, a fixed run of bytes that ties the preimage on the stack to
    // the transaction being signed. push-tx-binding.js defines the constant.
    if (token === 'checkPreimage') {
      var bindingBytes = hexToBytes(CHECK_PREIMAGE_BINDING_HEX);
      for (var b = 0; b < bindingBytes.length; b++) {
        output.push(bindingBytes[b]);
      }
      continue;
    }

    // Hex data literal
    if (token.indexOf('0x') === 0) {
      var hexStr = token.substring(2);
      if (hexStr.length % 2 !== 0) {
        throw new Error('Hex literal must have even number of digits: ' + token);
      }
      var dataBytes = hexToBytes(hexStr);
      var pushBytes = emitPushData(dataBytes);
      for (var i = 0; i < pushBytes.length; i++) {
        output.push(pushBytes[i]);
      }
      continue;
    }

    // Integer literal. Script numbers are arbitrary width, so parseInt would
    // round anything past 2^53 to a different number.
    if (/^-?\d+$/.test(token)) {
      var num = BigInt(token);
      if (num === 0n) {
        output.push(0x00);
      } else if (num >= 1n && num <= 16n) {
        output.push(0x50 + Number(num));
      } else if (num === -1n) {
        output.push(0x4f);
      } else {
        var encoded = encodeScriptNumber(num);
        var pushBytes2 = emitPushData(encoded);
        for (var j = 0; j < pushBytes2.length; j++) {
          output.push(pushBytes2[j]);
        }
      }
      continue;
    }

    throw new Error('Unknown token: ' + token);
  }

  return bytesToHex(new Uint8Array(output));
}

function disassemble(hexString) {
  var bytes = hexToBytes(hexString);
  var parts = [];
  var i = 0;

  var bindingHex = CHECK_PREIMAGE_BINDING_HEX;

  while (i < bytes.length) {
    var op = bytes[i];

    // The OP_PUSH_TX binding is one logical instruction. Print the token that
    // produced it rather than 428 bytes of opcodes.
    if (bytesToHex(bytes.slice(i, i + bindingHex.length / 2)) === bindingHex) {
      parts.push('checkPreimage');
      i += bindingHex.length / 2;
      continue;
    }

    // Direct push: 1-75 bytes
    if (op >= 0x01 && op <= 0x4b) {
      var len = op;
      i++;
      if (i + len > bytes.length) {
        parts.push('[INVALID: truncated push of ' + len + ' bytes]');
        break;
      }
      parts.push(bytesToHex(bytes.slice(i, i + len)));
      i += len;
      continue;
    }

    // OP_PUSHDATA1
    if (op === 0x4c) {
      i++;
      if (i >= bytes.length) { parts.push('[INVALID: truncated OP_PUSHDATA1]'); break; }
      var len1 = bytes[i];
      i++;
      if (i + len1 > bytes.length) { parts.push('[INVALID: truncated OP_PUSHDATA1 data]'); break; }
      parts.push(bytesToHex(bytes.slice(i, i + len1)));
      i += len1;
      continue;
    }

    // OP_PUSHDATA2
    if (op === 0x4d) {
      i++;
      if (i + 2 > bytes.length) { parts.push('[INVALID: truncated OP_PUSHDATA2]'); break; }
      var len2 = bytes[i] | (bytes[i + 1] << 8);
      i += 2;
      if (i + len2 > bytes.length) { parts.push('[INVALID: truncated OP_PUSHDATA2 data]'); break; }
      parts.push(bytesToHex(bytes.slice(i, i + len2)));
      i += len2;
      continue;
    }

    // OP_PUSHDATA4, which emitPushData emits past 65535 bytes
    if (op === 0x4e) {
      i++;
      if (i + 4 > bytes.length) { parts.push('[INVALID: truncated OP_PUSHDATA4]'); break; }
      var len4 = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
      i += 4;
      if (i + len4 > bytes.length) { parts.push('[INVALID: truncated OP_PUSHDATA4 data]'); break; }
      parts.push(bytesToHex(bytes.slice(i, i + len4)));
      i += len4;
      continue;
    }

    // Named opcode
    if (OPCODE_NAMES[op]) {
      parts.push(OPCODE_NAMES[op]);
    } else {
      parts.push('[0x' + (op < 16 ? '0' : '') + op.toString(16) + ']');
    }
    i++;
  }

  return parts.join(' ');
}
