// Parsing for the initial stack text box.
//
// The old code ran every item through Number(), which silently turned
// '0xdead' into 57005 and a full sighash preimage into Infinity. Only two
// forms are accepted now, and anything else is an error rather than a guess.

// Split the box the way Bitcoin Script splits tokens: on any whitespace.
function splitStackInput(text) {
  return String(text).split(/\s+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

// Returns { value, type } for an accepted item, or { error } naming the item.
function parseStackItem(item) {
  if (/^-?\d+$/.test(item)) {
    return { value: Number(item), type: 'number' };
  }
  if (/^0x([0-9a-fA-F]{2})*$/.test(item)) {
    return { value: item, type: 'hex' };
  }
  return {
    error: `Initial stack item "${item}" is not a decimal number or 0x-prefixed hex, so it was dropped`
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { splitStackInput, parseStackItem };
}
