// The push encoding both processes need: the renderer compiles scripts with
// it, and the main process builds the unlocking script it hands to the Rúnar
// ScriptVM. Two copies drifted apart, and the main process's copy emitted
// pushes a node would reject as non-minimal.

// Minimal push: the shortest encoding that yields the same stack item. An
// empty item is OP_0, a single byte 1-16 is OP_1..OP_16, and a single 0x81 is
// OP_1NEGATE. Nodes reject any longer encoding of these as non-minimal, so
// emitting one would produce a script that cannot be spent.
function emitPushData(dataBytes) {
  var out = [];
  var len = dataBytes.length;

  if (len === 0) {
    return [0x00];
  }
  if (len === 1 && dataBytes[0] >= 1 && dataBytes[0] <= 16) {
    return [0x50 + dataBytes[0]];
  }
  if (len === 1 && dataBytes[0] === 0x81) {
    return [0x4f];
  }

  if (len <= 75) {
    out.push(len);
  } else if (len <= 255) {
    out.push(0x4c, len);
  } else if (len <= 65535) {
    out.push(0x4d, len & 0xff, (len >> 8) & 0xff);
  } else if (len <= 0xffffffff) {
    out.push(0x4e, len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff);
  } else {
    throw new Error('Push data too large: ' + len + ' bytes');
  }

  for (var i = 0; i < dataBytes.length; i++) {
    out.push(dataBytes[i]);
  }
  return out;
}

// The same push as a hex string, which is how the main process builds scripts.
function pushDataHex(itemHex) {
  var bytes = [];
  for (var i = 0; i < itemHex.length; i += 2) {
    bytes.push(parseInt(itemHex.substr(i, 2), 16));
  }
  return emitPushData(bytes).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { emitPushData, pushDataHex };
}
