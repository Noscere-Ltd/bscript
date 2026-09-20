// Splitting a chain locking script into its code and its state.
//
// chain.js is a renderer script with no exports, so it is loaded the way the
// renderer loads it and the prototype is used directly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'renderer');
const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');

const ChainEngine = new Function(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'push-data.js'), 'utf8') +
  fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'script-walk.js'), 'utf8') +
  read('push-tx-binding.js') + read('compiler.js') + read('chain.js') +
  '\nreturn ChainEngine;'
)();

// loadProject expands macros with the interpreter, a global in the renderer
globalThis.ScriptInterpreter = require('./helpers').ScriptInterpreter;

const engine = new ChainEngine();

const project = (overrides) => Object.assign({
  name: 'Counter',
  contract: './c.bscript',
  stateFields: [{ name: 'count', type: 'int' }, { name: 'owner', type: 'bytes' }],
  methods: [{ name: 'increment', params: [] }],
  initialState: { count: 0, owner: '' }
}, overrides);

const loaded = (initialState) => {
  const e = new ChainEngine();
  e.loadProject(project({ initialState }), { './c.bscript': '1' });
  return e;
};

test('the code portion ends at the OP_RETURN that carries the state', () => {
  // <OP_1> <OP_RETURN> <push 02 aabb>: code is just OP_1
  assert.strictEqual(engine.getCodePortion('516a02aabb'), '51');
});

test('an OP_RETURN inside a push is not a separator', () => {
  // The 0x6a here is data pushed by OP_PUSHDATA1, not an opcode
  const script = '514c03' + '6a6a6a' + '6a02aabb';
  assert.strictEqual(engine.getCodePortion(script), '514c036a6a6a');
});

test('the split is at the last OP_RETURN, which is where the state begins', () => {
  // A contract may carry an OP_RETURN of its own. buildLockingScript appends
  // the state after the last one, so splitting at the first loses the rest of
  // the code.
  assert.strictEqual(engine.getCodePortion('516a5152' + '6a02aabb'), '516a5152');
});

test('a script with no OP_RETURN is all code', () => {
  assert.strictEqual(engine.getCodePortion('515253'), '515253');
});

test('PUSHDATA4 data is stepped over, not read as opcodes', () => {
  // OP_PUSHDATA4 with a length of 2, then the data, then the state OP_RETURN
  const script = '4e02000000' + '6aab' + '6a0201';
  assert.strictEqual(engine.getCodePortion(script), '4e020000006aab');
  assert.strictEqual(engine.findCodeSeparator(script), undefined);
});

test('findCodeSeparator reports the last real OP_CODESEPARATOR', () => {
  assert.strictEqual(engine.findCodeSeparator('51ab52ab53'), 3);
  assert.strictEqual(engine.findCodeSeparator('5152'), undefined);
  // 0xab inside a push is data
  assert.strictEqual(engine.findCodeSeparator('01ab'), undefined);
});

test('a project that fails to load leaves the loaded one untouched', () => {
  const e = loaded({ count: 7, owner: 'ab' });
  const before = JSON.parse(JSON.stringify(e));

  // Compiles, then throws while serialising the initial state
  assert.throws(() => e.loadProject(
    project({ name: 'Broken', initialState: { count: 0, owner: 'zz' } }),
    { './c.bscript': '2' }));
  // Throws while compiling the contract
  assert.throws(() => e.loadProject(project({ name: 'Broken' }), { './c.bscript': 'notAnOpcode' }));

  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), before);
  assert.strictEqual(e.project.name, 'Counter');
});

test('method unlock scripts are not compiled', () => {
  const e = new ChainEngine();
  e.loadProject(
    project({ methods: [{ name: 'increment', unlock: './m.bscript', params: [] }] }),
    { './c.bscript': '1', './m.bscript': 'notAnOpcode' });
  assert.strictEqual(e.methodHexMap, undefined);
});

test('a bytes state field takes hex with or without 0x, and nothing else', () => {
  assert.strictEqual(loaded({ count: 0, owner: '0xabcd' }).serializeState({ count: 0, owner: '0xabcd' }), '0002abcd');
  assert.strictEqual(loaded({ count: 0, owner: 'abcd' }).serializeState({ count: 0, owner: 'ABCD' }), '0002abcd');

  const e = loaded({ count: 0, owner: '' });
  assert.throws(() => e.serializeState({ count: 0, owner: 'zz' }), /"owner"/);
  assert.throws(() => e.serializeState({ count: 0, owner: 'abc' }), /"owner"/);
  assert.throws(() => e.serializeState({ count: 0, owner: '0xabcg' }), /"owner"/);
});

test('an int state field keeps every digit or is refused', () => {
  const e = loaded({ count: 0, owner: '' });
  // 2^53 + 1 as a decimal string: 01 00 00 00 00 00 20 little endian
  assert.strictEqual(e.serializeState({ count: '9007199254740993', owner: '' }), '0701000000000020' + '00');
  assert.strictEqual(e.serializeState({ count: -5, owner: '' }), '0185' + '00');
  // JSON.parse has already rounded this one
  assert.throws(() => e.serializeState({ count: 9007199254740993, owner: '' }), /"count"/);
  assert.throws(() => e.serializeState({ count: '1e3', owner: '' }), /"count"/);
  assert.throws(() => e.serializeState({ count: 1.5, owner: '' }), /"count"/);
});

test('compileContract tells an edited contract from the loaded one', () => {
  const e = loaded({ count: 0, owner: '' });
  assert.strictEqual(e.compileContract('1 // a comment changes nothing'), e.contractHex);
  assert.notStrictEqual(e.compileContract('2'), e.contractHex);
});

// F89
test('a contract that uses import is refused with a reason', () => {
  const e = new ChainEngine();
  assert.throws(() => e.loadProject(project(), { './c.bscript': "import * from './lib.bscript'\n1" }),
    /cannot use import/);
  // The word in a comment is not an import
  e.loadProject(project(), { './c.bscript': '// import nothing from here\n1' });
});
