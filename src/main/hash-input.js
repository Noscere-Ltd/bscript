// Stack items carry bytes as 0x-prefixed hex; anything else is treated as text
function toHashBuffer(data) {
  if (typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data)) {
    return Buffer.from(data.slice(2), 'hex');
  }
  return Buffer.from(String(data), 'utf8');
}

module.exports = { toHashBuffer };
