// Load the application scripts once the Monaco AMD loader is in place. This
// lives in a file rather than inline so the CSP can drop 'unsafe-inline' from
// script-src.
//
// Order matters: escape-html.js and push-tx-binding.js define globals the
// scripts after them read at load time.
const APP_SCRIPTS = [
  'escape-html.js',
  'interpreter.js',
  'syntax.js',
  'push-tx-binding.js',
  'stack-input.js',
  'compiler.js',
  'chain.js',
  'chain-ui.js',
  'app.js'
];

const loadScript = (src) => new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = src;
  el.onload = resolve;
  el.onerror = () => reject(new Error('Failed to load ' + src));
  document.body.appendChild(el);
});

// Wait for Monaco loader to be available
if (typeof require !== 'undefined' && typeof require.config !== 'undefined') {
  APP_SCRIPTS.reduce(
    (chain, src) => chain.then(() => loadScript(src)),
    Promise.resolve()
  ).catch((err) => console.error(err));
}
