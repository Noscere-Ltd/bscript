// F25: markup that reaches innerHTML runs in the renderer, which holds the
// wallet and the filesystem bridge. These check the two places where text the
// user did not write still passes through innerHTML.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('../src/renderer/escape-html');

const SRC = path.join(__dirname, '..', 'src', 'renderer');
const PAYLOAD = '<img/src=x/onerror=alert(1)>';

test('escapeHtml leaves no tag and no quote intact', () => {
  const escaped = escapeHtml(PAYLOAD);
  assert.ok(!escaped.includes('<'), escaped);
  assert.ok(!escaped.includes('>'), escaped);
  assert.strictEqual(escaped, '&lt;img/src=x/onerror=alert(1)&gt;');
  assert.strictEqual(escapeHtml('a & b "c" \'d\''), 'a &amp; b &quot;c&quot; &#39;d&#39;');
});

test('renderAIMarkdown emits no tag the reply asked for', () => {
  // ai-markdown.js is a renderer global script that reads escapeHtml
  const source = fs.readFileSync(path.join(SRC, 'ai-markdown.js'), 'utf8');
  const renderAIMarkdown = new Function('escapeHtml', `${source}\nreturn renderAIMarkdown;`)(escapeHtml);

  for (const reply of [PAYLOAD, `**bold** ${PAYLOAD}`, '```\n' + PAYLOAD + '\n```', `\`${PAYLOAD}\``]) {
    const html = renderAIMarkdown(reply);
    assert.ok(!/<img/i.test(html), `img tag survived: ${html}`);
    assert.ok(!/onerror/i.test(html) || !/<[a-z]/i.test(html.replace(/<\/?(p|br|strong|em|code|pre)>/g, '')),
      `an attribute escaped into markup: ${html}`);
  }

  // The formatting it is supposed to produce still works.
  assert.match(renderAIMarkdown('**yes**'), /<strong>yes<\/strong>/);
});

test('the renderer builds untrusted panels with the DOM, not innerHTML', () => {
  // The chain panel renders field names and state straight out of a .bsm.json.
  const chainUi = fs.readFileSync(path.join(SRC, 'chain-ui.js'), 'utf8');
  assert.ok(!chainUi.includes('innerHTML'), 'chain-ui.js still writes innerHTML');

  // Every innerHTML left in app.js must be a literal with no interpolation,
  // except the help panel (a file shipped with the app) and the AI panel
  // (escaped by renderAIMarkdown).
  const allowed = ["document.getElementById('help-content').innerHTML = html;",
                   'contentEl.innerHTML = renderAIMarkdown(content);'];
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');

  for (const line of app.split('\n')) {
    if (!line.includes('innerHTML')) continue;
    const trimmed = line.trim();
    if (allowed.includes(trimmed)) continue;
    assert.match(trimmed, /innerHTML = (''|`[^${}]*`|'[^']*')\s*;?$/,
      `innerHTML written with something other than a literal: ${trimmed}`);
  }
});

test('the CSP does not allow inline script', () => {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));

  assert.ok(!scriptSrc.includes("'unsafe-inline'"), scriptSrc);
  assert.ok(!/<script>/.test(html), 'index.html still has an inline script block');
});
