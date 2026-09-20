// The AI panel's markdown.
//
// A reply is untrusted, so everything is escaped before any tag is added.
// Fenced code comes out first and goes back in last, escaped and otherwise
// untouched. It used to go through the paragraph split and the italic and
// inline-code rules with the rest, so `// price * qty * 2` reached the editor
// through Insert to Editor as `// price  qty  2`.
//
// Reads escapeHtml from escape-html.js, which boot.js loads first.

function renderAIMarkdown(text) {
  var blocks = [];

  // NUL marks where a block was. Strip any the reply carries, so it cannot
  // forge a marker.
  var rest = String(text).replace(/\u0000/g, '')
    .replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      blocks.push(code);
      return '\n\n\u0000' + (blocks.length - 1) + '\u0000\n\n';
    });

  var html = escapeHtml(rest);

  // Inline code, held aside like the blocks so bold and italic leave it alone
  var spans = [];
  html = html.replace(/`([^`]+)`/g, function (_, code) {
    spans.push(code);
    return '\u0000c' + (spans.length - 1) + '\u0000';
  });

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Blank lines separate paragraphs, and a code block is one of its own
  return html.split('\n\n').map(function (para) {
    var marker = para.trim().match(/^\u0000(\d+)\u0000$/);
    if (marker) return '<pre><code>' + escapeHtml(blocks[Number(marker[1])]) + '</code></pre>';
    if (!para.trim()) return '';
    return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
  }).join('').replace(/\u0000c(\d+)\u0000/g, function (_, i) { return '<code>' + spans[Number(i)] + '</code>'; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderAIMarkdown };
}
