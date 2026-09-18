// Walking a compiled script opcode by opcode.
//
// A byte inside a push is not an opcode, so anything that scans a script for
// one - the chain engine looking for its OP_RETURN, Verify looking for a
// signature check - has to step over push data to find the truth.

function forEachOpcode(bytes, visit) {
  var i = 0;

  while (i < bytes.length) {
    var op = bytes[i];
    visit(op, i);

    if (op >= 0x01 && op <= 0x4b) {
      i += 1 + op;
    } else if (op === 0x4c) { // OP_PUSHDATA1
      if (i + 1 >= bytes.length) break;
      i += 2 + bytes[i + 1];
    } else if (op === 0x4d) { // OP_PUSHDATA2
      if (i + 2 >= bytes.length) break;
      i += 3 + (bytes[i + 1] | (bytes[i + 2] << 8));
    } else if (op === 0x4e) { // OP_PUSHDATA4
      if (i + 4 >= bytes.length) break;
      i += 5 + ((bytes[i + 1] | (bytes[i + 2] << 8) | (bytes[i + 3] << 16) |
        (bytes[i + 4] << 24)) >>> 0);
    } else {
      i++;
    }
  }
}

// Does the script execute any of these opcodes, as opcodes rather than data?
function usesOpcode(bytes, opcodes) {
  var found = false;
  forEachOpcode(bytes, function (op) {
    if (opcodes.indexOf(op) !== -1) found = true;
  });
  return found;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { forEachOpcode, usesOpcode };
}
