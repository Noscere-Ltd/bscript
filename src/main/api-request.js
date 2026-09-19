const http = require('http');
const https = require('https');

// POST a JSON body and resolve with the parsed JSON reply. Rejects on a
// non-2xx status, a 2xx body that is not JSON, or a socket idle for timeoutMs.
function makeApiRequest(url, options, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const transport = new URL(url).protocol === 'http:' ? http : https;
    const req = transport.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`API reply is not JSON (${res.statusCode}): ${data.slice(0, 200)}`));
          }
        } else {
          let errMsg;
          try {
            const parsed = JSON.parse(data);
            errMsg = parsed.error?.message || JSON.stringify(parsed);
          } catch {
            errMsg = data;
          }
          reject(new Error(`API error (${res.statusCode}): ${errMsg}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`API request timed out after ${timeoutMs} ms`));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = { makeApiRequest };
