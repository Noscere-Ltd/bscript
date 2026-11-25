// Run settings saved in a .bscript file as `// @key value` comment lines.
//
// The compiler skips comments, so the directives never change the script
// bytes. Only the keys below are read: a downloaded file must not be able to
// set the network, the AI key or anything the deploy panel uses.
//
//   // @txVersion 2              1 or 2
//   // @signatures on            real signature verification
//   // @sighash <64 hex>         sighash context
//   // @spendingTx <hex>         full transaction context, with the next three
//   // @inputIndex 0
//   // @prevScript self          `self` means this script compiled, or hex
//   // @prevSatoshis 1000
//   // @stack 0x01 2 0x03        initial stack, bottom to top

const SETTING_KEYS = [
  'txVersion', 'signatures', 'sighash',
  'spendingTx', 'inputIndex', 'prevScript', 'prevSatoshis', 'stack'
];

const SETTING_FORMAT = {
  txVersion: /^[12]$/,
  signatures: /^(on|off)$/,
  sighash: /^[0-9a-fA-F]{64}$/,
  spendingTx: /^([0-9a-fA-F]{2})+$/,
  inputIndex: /^\d+$/,
  prevScript: /^(self|([0-9a-fA-F]{2})+)$/,
  prevSatoshis: /^\d+$/,
  stack: /^.+$/
};

const DIRECTIVE = /^\s*\/\/\s*@(\w+)(?:\s+(.*?))?\s*$/;

// Directives are read from the leading comment block only, so a `// @` line
// further down the script stays an ordinary comment.
function headerLength(lines) {
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trimStart().startsWith('//'))) i++;
  return i;
}

// Returns { values, errors }. values holds each valid directive as a string,
// keyed by name. errors names every directive that was ignored and why.
function parseScriptSettings(text) {
  const lines = String(text).split(/\r?\n/);
  const values = {};
  const errors = [];
  const end = headerLength(lines);
  for (let i = 0; i < end; i++) {
    const m = lines[i].match(DIRECTIVE);
    if (!m) continue;
    const [, key, value = ''] = m;
    if (!SETTING_KEYS.includes(key)) {
      errors.push(`line ${i + 1}: @${key} is not a script setting, so it was ignored`);
    } else if (!SETTING_FORMAT[key].test(value)) {
      errors.push(`line ${i + 1}: @${key} "${value.slice(0, 40)}" is not valid, so it was ignored`);
    } else {
      values[key] = value;
    }
  }
  return { values, errors };
}

// Replaces the setting directives in the header with values, keeping the
// script and every other comment. The new block goes where the first old
// directive was, or at the top of the file.
function writeScriptSettings(text, values) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  const lines = String(text).split(/\r?\n/);
  const end = headerLength(lines);
  const block = SETTING_KEYS
    .filter((key) => values[key] !== undefined && values[key] !== '')
    .map((key) => `// @${key} ${values[key]}`);

  let at = -1;
  const kept = [];
  lines.forEach((line, i) => {
    const m = i < end && line.match(DIRECTIVE);
    if (m && SETTING_KEYS.includes(m[1])) {
      if (at < 0) at = kept.length;
      return;
    }
    kept.push(line);
  });

  if (at < 0) {
    if (block.length === 0) return text;
    at = 0;
    if (kept.length > 0 && kept[0].trim() !== '') block.push('');
  }
  kept.splice(at, 0, ...block);
  return kept.join(eol);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SETTING_KEYS, parseScriptSettings, writeScriptSettings };
}
