// Shared rig for the interpreter tests.
//
// interpreter.js is a renderer script: it reaches for window.bsv for the hash
// opcodes. Mirror what the main process does so the ops can run under node.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { toHashBuffer } = require('../src/main/hash-input');

const digest = (algorithm) => async (data) =>
  crypto.createHash(algorithm).update(toHashBuffer(data)).digest('hex');

global.window = {
  bsv: {
    sha1: digest('sha1'),
    sha256: digest('sha256'),
    ripemd160: digest('ripemd160'),
    hash256: async (data) => {
      const once = crypto.createHash('sha256').update(toHashBuffer(data)).digest();
      return crypto.createHash('sha256').update(once).digest('hex');
    },
    hash160: async (data) => {
      const once = crypto.createHash('sha256').update(toHashBuffer(data)).digest();
      return crypto.createHash('ripemd160').update(once).digest('hex');
    }
  }
};

const ScriptInterpreter = require('../src/renderer/interpreter.js');

// compiler.js and push-tx-binding.js are renderer global scripts with no
// exports. Load them in the order index.html does: the compiler reads the
// binding constant the other one defines.
const renderer = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');

const { compileInstructionsToHex, disassemble } = new Function(
  renderer('push-tx-binding.js') + renderer('compiler.js') +
  '\nreturn { compileInstructionsToHex, disassemble };'
)();

// A 181-byte BIP-143 preimage with recognisable field values: version 2,
// input index 1, amount 10000, sequence 0xffffffff, hashOutputs all 0xcc,
// locktime 1000, sighash type 0x41.
const PREIMAGE = '0x' + [
  '02000000',                          // nVersion
  '00'.repeat(32),                     // hashPrevouts
  '11'.repeat(32),                     // hashSequence
  'aa'.repeat(32) + '01000000',        // outpoint: txid + input index 1
  '76a914' + 'bb'.repeat(20) + '88ac', // scriptCode (25 bytes)
  '1027000000000000',                  // amount = 10000
  'ffffffff',                          // nSequence
  'cc'.repeat(32),                     // hashOutputs
  'e8030000',                          // nLocktime = 1000
  '41000000'                           // sighash type = 65
].join('');

// Run a script, asserting it succeeded, and return the interpreter.
async function exec(script, initialStack = []) {
  const assert = require('node:assert');
  const interp = new ScriptInterpreter();
  const result = await interp.run(script, initialStack);
  assert.ok(result.success, `script failed: ${result.error}`);
  return interp;
}

// Run a script and return its final stack.
async function stack(script, initialStack = []) {
  return (await exec(script, initialStack)).mainStack;
}

// Run a script and return the error it failed with, or null if it succeeded.
async function failure(script, initialStack = []) {
  const interp = new ScriptInterpreter();
  const result = await interp.run(script, initialStack);
  return result.success ? null : result.error;
}

// Top of stack after running a script.
async function top(script, initialStack = []) {
  const items = await stack(script, initialStack);
  return items[items.length - 1];
}

module.exports = {
  ScriptInterpreter, PREIMAGE, exec, stack, failure, top,
  compileInstructionsToHex, disassemble
};
