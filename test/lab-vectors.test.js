// Replays the signature templates from bsv-script-lab through the interpreter
// with real signature checks, and compares each verdict with the lab's.
//
// The fixtures under test/fixtures/lab hold the lab's own cases: every
// locking script (stored once, keyed by a sha256 prefix), the unlocking
// script, the spending transaction and the verdict the lab expects. Each lock
// is turned into tokens and compiled back first, so a case only counts when
// the interpreter ran the exact bytes the lab published.
//
// The examples under examples/lab are those same locks, one token per line.
// A single line of 158k tokens overflows the parser's spread push.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Transaction } = require('@bsv/sdk');
const { ScriptInterpreter, compileInstructionsToHex, OPCODE_MAP } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'lab');
const EXAMPLES = path.join(__dirname, '..', 'examples', 'lab');
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

// The first name the compiler accepts for each opcode byte. The small numbers
// get their numeric spelling, which the parser reads as the constant opcode.
const NAMES = {};
for (const [name, byte] of Object.entries(OPCODE_MAP)) if (!(byte in NAMES)) NAMES[byte] = name;
for (let n = 0; n <= 16; n++) NAMES[n === 0 ? 0 : 0x50 + n] = String(n);
NAMES[0x4f] = '-1';

// Raw script hex to source tokens: pushes become 0x literals.
function tokens(hex) {
  const bytes = Buffer.from(hex, 'hex');
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i++];
    let len = -1;
    if (op >= 0x01 && op <= 0x4b) len = op;
    else if (op === 0x4c) { len = bytes[i]; i += 1; }
    else if (op === 0x4d) { len = bytes.readUInt16LE(i); i += 2; }
    else if (op === 0x4e) { len = bytes.readUInt32LE(i); i += 4; }
    if (len >= 0) {
      out.push('0x' + bytes.subarray(i, i + len).toString('hex'));
      i += len;
    } else if (op in NAMES) {
      out.push(NAMES[op]);
    } else {
      throw new Error(`no source name for opcode 0x${op.toString(16)} at byte ${i - 1}`);
    }
  }
  return out;
}

// An unlocking script is push-only, so it becomes the initial stack. Small
// numbers go in as script numbers, the way the stack field parses them.
const initialStack = (hex) => tokens(hex).map((t) => (/^-?\d+$/.test(t) ? BigInt(t) : t));

async function spend(source, c, lockHex) {
  const interp = new ScriptInterpreter();
  interp.txVersion = Transaction.fromHex(c.tx).version;
  interp.enableSignatures = true;
  interp.setTransactionContext({
    txHex: c.tx, inputIndex: c.index, prevScriptHex: lockHex, satoshis: c.sats
  });
  return interp.run(source, initialStack(c.unlock));
}

for (const name of ['baseline', 'lamport', 'r1', 'sm2']) {
  test(`${name}: every lab case gets the lab's verdict`, async () => {
    const { locks, cases } = load(name);
    const source = {};
    for (const [id, hex] of Object.entries(locks)) {
      const toks = tokens(hex);
      assert.strictEqual(compileInstructionsToHex(toks), hex, `lock ${id} does not round-trip`);
      source[id] = toks.join('\n');
    }

    const disagree = [];
    for (const c of cases) {
      const result = await spend(source[c.lock], c, locks[c.lock]);
      // The interpreter takes Chronicle activation from the transaction
      // version. The lab also runs version 1 transactions after activation,
      // which it accepts and this interpreter refuses. Pin that refusal so a
      // change to it shows up here.
      const expected = c.knownGap === 'chronicle-activation' ? false : c.expected;
      if (result.success !== expected) {
        disagree.push(`${c.label}: expected ${expected}, got ${result.success} ${result.error || ''}`);
      } else if (c.knownGap) {
        assert.match(result.error, /invalid before Chronicle/, c.label);
      }
    }
    assert.deepStrictEqual(disagree, []);
  });
}

// Each example runs the valid spend its header names, from the file itself.
const EXAMPLE_FIXTURE = {
  p2pkh: 'baseline', p2pk: 'baseline', 'lamport-ots': 'lamport', 'p2pkh-r1': 'r1', 'p2pkh-sm2': 'sm2'
};

test('every lab example is covered here', () => {
  const files = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.bscript'))
    .map((f) => f.replace('.bscript', ''));
  assert.deepStrictEqual(files.sort(), Object.keys(EXAMPLE_FIXTURE).sort());
});

for (const [example, name] of Object.entries(EXAMPLE_FIXTURE)) {
  test(`examples/lab/${example}.bscript compiles to the lab's bytes and spends`, async () => {
    const text = fs.readFileSync(path.join(EXAMPLES, `${example}.bscript`), 'utf8');
    const label = text.match(/valid spend "([^"]+)"/)[1];
    const { locks, cases } = load(name);
    const c = cases.find((x) => x.label === label);
    const lockHex = locks[c.lock];

    const toks = text.split('\n').filter((l) => !l.startsWith('//') && l.trim());
    assert.strictEqual(compileInstructionsToHex(toks), lockHex);

    const result = await spend(text, c, lockHex);
    assert.ok(result.success, result.error);
  });
}
