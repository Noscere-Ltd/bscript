// Anything that reaches innerHTML has to be escaped first. Script text, chain
// project fields and AI replies are all untrusted: a `<img src=x onerror=...>`
// in a field name or a failing token would otherwise run with the renderer's
// privileges, which include the wallet and the filesystem.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build an element with text children only. `parts` is a list of
// [className, text] pairs.
function elementWithSpans(tagName, className, parts) {
  var el = document.createElement(tagName);
  if (className) el.className = className;
  for (var i = 0; i < parts.length; i++) {
    var span = document.createElement('span');
    span.className = parts[i][0];
    span.textContent = parts[i][1];
    el.appendChild(span);
  }
  return el;
}

// Replace a container's children with one placeholder line.
function replaceWithPlaceholder(container, className, text) {
  container.textContent = '';
  var div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  container.appendChild(div);
}

// Export for use in app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml };
}
