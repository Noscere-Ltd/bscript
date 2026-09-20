// What the renderer shows: AI replies, disassembly, step decorations.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../src/renderer/escape-html');
const { compileInstructionsToHex, disassemble } = require('./helpers');

const SRC = path.join(__dirname, '..', 'src', 'renderer');
const renderAIMarkdown = new Function('escapeHtml',
  fs.readFileSync(path.join(SRC, 'ai-markdown.js'), 'utf8') + '\nreturn renderAIMarkdown;')(escapeHtml);

// What Insert to Editor reads back: the text content of the first code block
const unescape = (html) => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const firstBlock = (html) => unescape(html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1]);

test('fenced code reaches Insert to Editor exactly as the reply wrote it', () => {
  // F59: the italic rule ate the asterisks, the inline-code rule ate the
  // backticks, and a blank line split the block into paragraphs
  const code = '// price * qty * 2\n5 3 mul\n\n// `dup` then **add**\ndup add <x> & "y"\n';
  const html = renderAIMarkdown('Here you go:\n\n```bscript\n' + code + '```\n\nThat *is* `all`.');

  assert.strictEqual(firstBlock(html), code);
  assert.doesNotMatch(html.match(/<pre>[\s\S]*<\/pre>/)[0], /<em>|<strong>|<p>|<br>|<code>[^<]*<code>/);

  // The prose around it is still formatted
  assert.match(html, /<p>Here you go:<\/p>/);
  assert.match(html, /<em>is<\/em>/);
  assert.match(html, /<code>all<\/code>/);
});

test('two fenced blocks stay separate and in order', () => {
  const html = renderAIMarkdown('```\n1 * 2\n```\nthen\n```\n3 * 4\n```');
  const blocks = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1]);
  assert.deepStrictEqual(blocks, ['1 * 2\n', '3 * 4\n']);
});

test('fenced code is still escaped, and a reply cannot forge a block marker', () => {
  const html = renderAIMarkdown('```\n<img src=x onerror=alert(1)>\n```');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);

  // A marker for block 0 when there is no block 0
  assert.doesNotMatch(renderAIMarkdown('\u00000\u0000'), /undefined|<pre>/);
});

test('disassemble reads OP_PUSHDATA4', () => {
  // F71: emitPushData emits it past 65535 bytes and disassemble printed the
  // length bytes and the data as opcodes
  assert.strictEqual(disassemble('4e03000000aabbcc51'), disassemble('03aabbcc51'));

  const data = 'ab'.repeat(65536);
  const hex = compileInstructionsToHex(['0x' + data, '1']);
  assert.strictEqual(hex.slice(0, 10), '4e00000100');
  assert.strictEqual(disassemble(hex), disassemble('51').replace(/^/, data + ' '));

  assert.match(disassemble('4e0300'), /truncated OP_PUSHDATA4/);
  assert.match(disassemble('4e03000000aa'), /truncated OP_PUSHDATA4 data/);
});

test('each step decoration replaces the one before it', () => {
  // F72. ponytail: source-level check, the call needs Monaco
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const highlight = app.match(/function highlightCurrentInstruction\(\)[\s\S]*?\n}/)[0];

  assert.match(highlight, /deltaDecorations\(editor\._currentDecorations \|\| \[\], \[/);
  assert.doesNotMatch(highlight, /deltaDecorations\(\[\], /);
});

// F88
test('italic and bold leave an inline code span alone', () => {
  assert.strictEqual(renderAIMarkdown('use `a * b * c` and *this*'),
    '<p>use <code>a * b * c</code> and <em>this</em></p>');
});
