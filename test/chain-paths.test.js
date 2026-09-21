// What a chain project file is allowed to name.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveProjectFile } = require('../src/main/chain-paths');

const DIR = path.resolve('/projects/counter');

test('a contract inside the project directory resolves', () => {
  assert.strictEqual(resolveProjectFile(DIR, './counter.bscript'), path.join(DIR, 'counter.bscript'));
  assert.strictEqual(resolveProjectFile(DIR, 'sub/a.bscript'), path.join(DIR, 'sub', 'a.bscript'));
});

test('a path that climbs out of the project directory is refused', () => {
  assert.throws(() => resolveProjectFile(DIR, '../../x'), /outside the project directory/);
  assert.throws(() => resolveProjectFile(DIR, '../../.ssh/id_rsa'), /outside the project directory/);
  assert.throws(() => resolveProjectFile(DIR, '../counter-evil/x.bscript'), /outside the project directory/);
  assert.throws(() => resolveProjectFile(DIR, 'sub/../../x.bscript'), /outside the project directory/);
});

test('an absolute path is refused', () => {
  assert.throws(() => resolveProjectFile(DIR, '/etc/passwd'), /outside the project directory/);
  assert.throws(() => resolveProjectFile(DIR, path.resolve('/elsewhere/x.bscript')), /outside the project directory/);
});

test('only .bscript files may be named', () => {
  assert.throws(() => resolveProjectFile(DIR, './notes.txt'), /only name \.bscript/);
  assert.throws(() => resolveProjectFile(DIR, './id_rsa'), /only name \.bscript/);
});

test('a project with no contract is refused', () => {
  assert.throws(() => resolveProjectFile(DIR, undefined), /does not name a contract/);
  assert.throws(() => resolveProjectFile(DIR, ''), /does not name a contract/);
});
