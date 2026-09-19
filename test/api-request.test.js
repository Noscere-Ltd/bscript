const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { makeApiRequest } = require('../src/main/api-request');

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const post = { method: 'POST', headers: { 'Content-Type': 'application/json' } };

test('F62: a 200 reply that is not JSON rejects instead of throwing outside the promise', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>Gateway login</body></html>');
  }, async (url) => {
    await assert.rejects(makeApiRequest(url, post, {}, 2000), /not JSON \(200\)/);
  });
});

test('F62: a server that never responds rejects after the timeout', async () => {
  await withServer(() => {}, async (url) => {
    await assert.rejects(makeApiRequest(url, post, {}, 100), /timed out after 100 ms/);
  });
});

test('F62: a JSON 200 reply still resolves with the parsed body', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  }, async (url) => {
    assert.deepStrictEqual(await makeApiRequest(url, post, {}, 2000), { ok: true });
  });
});
