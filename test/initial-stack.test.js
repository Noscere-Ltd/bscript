// The initial stack text box is the only place a user hands raw values to the
// interpreter. Number() used to parse it, which quietly corrupted every hex
// item, so these tests pin what is accepted and what is refused.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { splitStackInput, parseStackItem } = require('../src/renderer/stack-input');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const read = (name) => fs.readFileSync(path.join(EXAMPLES, `${name}.bscript`), 'utf8');
const preimageFrom = (name) => read(name).match(/0x02000000[0-9a-f]+/)[0];

const parse = (text) => splitStackInput(text).map(parseStackItem);
const values = (text) => parse(text).map((r) => r.value);

test('decimal integers become numbers', () => {
  assert.deepStrictEqual(values('0 42 -7'), [0, 42, -7]);
  assert.deepStrictEqual(parse('42')[0].type, 'number');
});

test('0x-prefixed hex is kept as the string it was typed as', () => {
  assert.deepStrictEqual(values('0xdead'), ['0xdead']);
  assert.strictEqual(parse('0xdead')[0].type, 'hex');
  // The empty push is a valid stack item
  assert.deepStrictEqual(values('0x'), ['0x']);
});

test('a full preimage survives instead of becoming Infinity', () => {
  const preimage = preimageFrom('op-push-tx');
  assert.strictEqual(Number(preimage), Infinity);
  assert.deepStrictEqual(values(preimage), [preimage]);
});

test('anything Number() would have guessed at is rejected by name', () => {
  for (const item of ['1e3', '0b11', '0o17', '1.5', 'Infinity', '0xabc', 'hello', '+5']) {
    const result = parseStackItem(item);
    assert.ok(result.error, `${item} should be rejected`);
    assert.ok(result.error.includes(item), `error should name ${item}: ${result.error}`);
    assert.strictEqual(result.value, undefined);
  }
});

test('items split on any whitespace and blank input is an empty stack', () => {
  assert.deepStrictEqual(splitStackInput('  0\t0xaa\n0xbb  '), ['0', '0xaa', '0xbb']);
  assert.deepStrictEqual(splitStackInput('   '), []);
});

// Every stack an example documents in its header must parse to the values
// test/examples.test.js runs that example with. Pull the documented lines out
// of the files so the headers and the tests cannot drift apart.
const documentedStacks = (name) => {
  const found = [];
  for (const line of read(name).split('\n')) {
    const comment = line.match(/^\s*\/\/(.*)$/);
    if (!comment) continue;
    let text = comment[1];
    if (/set initial stack to/i.test(text)) text = text.slice(text.lastIndexOf(':') + 1);
    const items = splitStackInput(text);
    if (items.length > 0 && items.every((item) => !parseStackItem(item).error)) {
      found.push(items.map((item) => parseStackItem(item).value));
    }
  }
  return found;
};

const DOCUMENTED = {
  'multisig-2of3': [0, '0xaa', '0xbb'],
  'hash-puzzle': [42],
  'p2pkh-checksig': ['0xdeadbeef', '0xcafebabe'],
  'covenant-locktime': [preimageFrom('covenant-locktime')],
  'covenant-output-hash': [preimageFrom('covenant-output-hash')],
  'covenant-rate-limit': ['0xaa', preimageFrom('covenant-rate-limit')],
  'op-push-tx': [preimageFrom('op-push-tx')]
};

for (const [name, expected] of Object.entries(DOCUMENTED)) {
  test(`${name}.bscript documents a stack the parser accepts`, () => {
    assert.deepStrictEqual(documentedStacks(name), [expected]);
  });
}

test('no other example documents a stack this list misses', () => {
  const withStacks = fs.readdirSync(EXAMPLES)
    .filter((f) => f.endsWith('.bscript'))
    .map((f) => f.replace('.bscript', ''))
    .filter((name) => documentedStacks(name).length > 0);

  assert.deepStrictEqual(withStacks.sort(), Object.keys(DOCUMENTED).sort());
});
