/**
 * SVSCRIPT Main Application
 * Integrates Monaco Editor, Script Interpreter, and UI Controls
 */

let editor;
let interpreter;
let executionMode = 'idle'; // idle, running, stepping
let currentFilePath = null; // Track current file for Save operation
let hasUnsavedChanges = false; // Track dirty state
let errorLineDecoration = []; // Track error line decoration

// Settings
let settings = {
  enableSignatures: false,
  network: 'mainnet',
  transactionVersion: 1  // Chronicle release: default version 1
};

// Initialize Monaco Editor
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  // Register Bitcoin Script language
  registerBitcoinScriptLanguage(monaco);

  // Create the editor instance
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: getDefaultScript(),
    language: 'bitcoinscript',
    theme: 'bitcoinscript-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    roundedSelection: false,
    scrollBeyondLastLine: false,
    readOnly: false,
    cursorStyle: 'line',
    wordWrap: 'off',
    folding: true,
    glyphMargin: true,
    lineDecorationsWidth: 10,
    lineNumbersMinChars: 3,
  });

  // Update cursor position display
  editor.onDidChangeCursorPosition((e) => {
    const position = e.position;
    document.getElementById('cursor-position').textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
  });

  // Track dirty state on editor changes
  editor.onDidChangeModelContent(() => {
    hasUnsavedChanges = true;
    updateWindowTitle();
  });

  // Initialize interpreter
  interpreter = new ScriptInterpreter();

  // Setup UI event handlers
  setupEventHandlers();

  // Setup menu event listeners
  if (window.electronAPI && window.electronAPI.onMenuAction) {
    window.electronAPI.onMenuAction('menu-new-file', newFile);
    window.electronAPI.onMenuAction('menu-open-file', openFile);
    window.electronAPI.onMenuAction('menu-save-file', saveFile);
    window.electronAPI.onMenuAction('menu-save-file-as', saveFileAs);
    window.electronAPI.onMenuAction('menu-run-script', runScript);
    window.electronAPI.onMenuAction('menu-step-script', stepScript);
    window.electronAPI.onMenuAction('menu-reset-script', resetScript);
    window.electronAPI.onMenuAction('menu-clear-stack', clearInitialStack);
    window.electronAPI.onMenuAction('menu-clear-console', clearConsole);
    window.electronAPI.onMenuAction('menu-about', showAbout);
    window.electronAPI.onMenuAction('menu-shortcuts', showKeyboardShortcuts);
  }

  // Initial UI update
  updateUI();
  updateWindowTitle();

  logToConsole('Editor initialized. Use File menu or keyboard shortcuts to manage scripts.', 'info');
});

// Default script example - demonstrates branching with multiple exit points
function getDefaultScript() {
  return `// Bitcoin Script Example: Branching with Multiple Exit Points
// This script demonstrates conditional logic with different execution paths
//
// TIP: Use the "Initial Stack" panel on the left to provide input values!
// Try entering a number like 42, 75, or 150 to see different execution paths.

// Duplicate the input for multiple tests
dup dup

// Test 1: Is it greater than 100?
100 greaterThan

if
  // Path A: Large number (>100)
  drop
  1000  // Return large value indicator
  verify  // Exit point 1: Must be non-zero to succeed
else
  // Continue to next test
  // Test 2: Is it greater than 50?
  dup 50 greaterThan

  if
    // Path B: Medium number (50-100)
    drop
    500  // Return medium value indicator
    verify  // Exit point 2: Must be non-zero to succeed
  else
    // Path C: Small number (<=50)
    drop
    100  // Return small value indicator
    verify  // Exit point 3: Must be non-zero to succeed
  endIf
endIf

// Different paths based on initial value:
// - 150 → Path A (>100) → returns 1000
// - 75  → Path B (50-100) → returns 500
// - 42  → Path C (<=50) → returns 100
`;
}

// Setup event handlers for UI controls
function setupEventHandlers() {
  document.getElementById('btn-run').addEventListener('click', runScript);
  document.getElementById('btn-step').addEventListener('click', stepScript);
  document.getElementById('btn-reset').addEventListener('click', resetScript);
  document.getElementById('btn-clear-console').addEventListener('click', clearConsole);
  document.getElementById('btn-clear-stack').addEventListener('click', clearInitialStack);
  document.getElementById('btn-help').addEventListener('click', showHelp);
  document.getElementById('btn-close-help').addEventListener('click', hideHelp);
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-close-settings').addEventListener('click', hideSettings);
  document.getElementById('btn-close-error-toast').addEventListener('click', hideErrorToast);

  // Tools panel event listeners
  document.getElementById('btn-tools').addEventListener('click', showTools);
  document.getElementById('btn-close-tools').addEventListener('click', hideTools);
  document.getElementById('btn-text-to-hex').addEventListener('click', convertTextToHex);
  document.getElementById('btn-hex-to-text').addEventListener('click', convertHexToText);
  document.getElementById('btn-calc-sha256').addEventListener('click', calculateSha256);
  document.getElementById('btn-copy-hex').addEventListener('click', () => copyToClipboard('text-to-hex-output'));
  document.getElementById('btn-copy-text').addEventListener('click', () => copyToClipboard('hex-to-text-output'));
  document.getElementById('btn-copy-sha256').addEventListener('click', () => copyToClipboard('sha256-output'));

  // Settings event listeners
  document.getElementById('enable-signatures').addEventListener('change', toggleSignatures);
  document.querySelectorAll('input[name="network"]').forEach(radio => {
    radio.addEventListener('change', changeNetwork);
  });

  // Chronicle release: Transaction version event listener
  document.getElementById('btn-apply-tx-version').addEventListener('click', applyTransactionVersion);

  // Transaction context event listeners
  document.querySelectorAll('input[name="tx-context-mode"]').forEach(radio => {
    radio.addEventListener('change', toggleTxContextMode);
  });
  document.getElementById('btn-apply-tx-context').addEventListener('click', applyTransactionContext);
  document.getElementById('btn-clear-tx-context').addEventListener('click', clearTransactionContext);

  // Update stack preview when input changes
  const stackInput = document.getElementById('initial-stack-input');
  stackInput.addEventListener('input', updateStackPreview);

  // Initialize empty preview
  updateStackPreview();
}

// Clear initial stack input
function clearInitialStack() {
  document.getElementById('initial-stack-input').value = '';
  updateStackPreview();
}

// Update the stack preview display
function updateStackPreview() {
  const input = document.getElementById('initial-stack-input').value;
  const previewContainer = document.getElementById('stack-preview');

  // Split by whitespace (space, tab, newline) - matching Bitcoin Script syntax
  const items = input.split(/\s+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);

  if (items.length === 0) {
    previewContainer.innerHTML = '<div class="stack-empty">No initial values</div>';
    return;
  }

  // Parse and display stack (reversed to show top to bottom)
  const reversedItems = [...items].reverse();
  let html = '';

  reversedItems.forEach((value, index) => {
    const actualIndex = items.length - 1 - index;
    const displayValue = value;
    const type = isNaN(Number(value)) ? 'string' : 'number';

    html += `
      <div class="stack-preview-item">
        <span class="stack-preview-index">[${actualIndex}]</span>
        <span class="stack-preview-value">${displayValue}</span>
        <span class="stack-preview-type">${type}</span>
      </div>
    `;
  });

  previewContainer.innerHTML = html;
}

// Get initial stack values from input
function getInitialStackValues() {
  const input = document.getElementById('initial-stack-input').value;

  // Split by whitespace (space, tab, newline) - matching Bitcoin Script syntax
  const items = input.split(/\s+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);

  return items.map(item => {
    // Try to parse as number, otherwise keep as string
    const num = Number(item);
    return isNaN(num) ? item : num;
  });
}

// Run entire script
async function runScript() {
  const script = editor.getValue();

  if (!script.trim()) {
    logToConsole('No script to execute', 'warning');
    return;
  }

  try {
    logToConsole('Executing script...', 'info');
    clearDecorations();
    hideErrorToast(); // Clear any previous errors

    // Get initial stack values
    const initialStack = getInitialStackValues();
    if (initialStack.length > 0) {
      logToConsole(`Initial stack: [${initialStack.join(', ')}]`, 'info');
    }

    const result = await interpreter.run(script, initialStack);

    if (result.success) {
      logToConsole('Script executed successfully', 'success');
      logToConsole(`Final stack: [${interpreter.mainStack.join(', ')}]`, 'info');
      updateUI();
      highlightCurrentInstruction();
    } else {
      logToConsole(`Error: ${result.error}`, 'error');
      updateUI();
      highlightCurrentInstruction();

      // Show error toast
      showErrorToast(
        interpreter.error,
        interpreter.errorInstruction || 'unknown',
        interpreter.errorLine
      );
    }
  } catch (error) {
    logToConsole(`Error: ${error.message}`, 'error');
    updateUI();

    // Show error toast
    showErrorToast(
      interpreter.error || error.message,
      interpreter.errorInstruction || 'unknown',
      interpreter.errorLine
    );
  }
}

// Step through script one instruction at a time
async function stepScript() {
  if (executionMode === 'idle') {
    // Start stepping mode
    const script = editor.getValue();
    if (!script.trim()) {
      logToConsole('No script to execute', 'warning');
      return;
    }

    // Get initial stack values
    const initialStack = getInitialStackValues();
    if (initialStack.length > 0) {
      logToConsole(`Initial stack: [${initialStack.join(', ')}]`, 'info');
    }

    await interpreter.parse(script, initialStack, currentFilePath);
    executionMode = 'stepping';
    logToConsole('Stepping mode started', 'info');
  }

  if (executionMode === 'stepping') {
    if (interpreter.ip >= interpreter.instructions.length) {
      logToConsole('Script execution completed', 'success');
      logToConsole(`Final stack: [${interpreter.mainStack.join(', ')}]`, 'info');
      executionMode = 'idle';
      updateUI();
      return;
    }

    try {
      const canContinue = await interpreter.step();
      updateUI();
      highlightCurrentInstruction();

      if (!canContinue || interpreter.status === 'error') {
        if (interpreter.status === 'error') {
          logToConsole(`Error: ${interpreter.error}`, 'error');

          // Show error toast
          showErrorToast(
            interpreter.error,
            interpreter.errorInstruction || 'unknown',
            interpreter.errorLine
          );
        }
        executionMode = 'idle';
      }
    } catch (error) {
      logToConsole(`Error: ${error.message}`, 'error');
      updateUI();

      // Show error toast
      showErrorToast(
        interpreter.error || error.message,
        interpreter.errorInstruction || 'unknown',
        interpreter.errorLine
      );

      executionMode = 'idle';
    }
  }
}

// Reset script execution
function resetScript() {
  interpreter.reset();
  executionMode = 'idle';
  clearDecorations();
  hideErrorToast(); // Clear any error messages
  updateUI();
  logToConsole('Script reset', 'info');
}

// Update all UI components
function updateUI() {
  updateStackDisplay();
  updateExecutionHistory();
  updateExecutionState();
  updateStatusBadge();
}

// Update stack visualization
function updateStackDisplay() {
  // Update main stack
  const mainStackEl = document.getElementById('main-stack');
  if (interpreter.mainStack.length === 0) {
    mainStackEl.innerHTML = '<div class="stack-empty">Empty</div>';
  } else {
    mainStackEl.innerHTML = '';
    // Display stack from top to bottom
    for (let i = interpreter.mainStack.length - 1; i >= 0; i--) {
      const value = interpreter.mainStack[i];
      const item = document.createElement('div');
      item.className = 'stack-item';

      const index = document.createElement('span');
      index.className = 'stack-item-index';
      index.textContent = `[${i}]`;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'stack-item-value';
      valueSpan.textContent = formatStackValue(value);

      const type = document.createElement('span');
      type.className = 'stack-item-type';
      type.textContent = typeof value;

      item.appendChild(index);
      item.appendChild(valueSpan);
      item.appendChild(type);
      mainStackEl.appendChild(item);
    }
  }

  // Update alternate stack
  const altStackEl = document.getElementById('alt-stack');
  if (interpreter.altStack.length === 0) {
    altStackEl.innerHTML = '<div class="stack-empty">Empty</div>';
  } else {
    altStackEl.innerHTML = '';
    // Display stack from top to bottom
    for (let i = interpreter.altStack.length - 1; i >= 0; i--) {
      const value = interpreter.altStack[i];
      const item = document.createElement('div');
      item.className = 'stack-item';

      const index = document.createElement('span');
      index.className = 'stack-item-index';
      index.textContent = `[${i}]`;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'stack-item-value';
      valueSpan.textContent = formatStackValue(value);

      const type = document.createElement('span');
      type.className = 'stack-item-type';
      type.textContent = typeof value;

      item.appendChild(index);
      item.appendChild(valueSpan);
      item.appendChild(type);
      altStackEl.appendChild(item);
    }
  }
}

// Format stack values for display
function formatStackValue(value) {
  if (typeof value === 'string' && value.length > 40) {
    return value.substring(0, 40) + '...';
  }
  return String(value);
}

// Update execution history
function updateExecutionHistory() {
  const historyEl = document.getElementById('execution-history');

  if (interpreter.executionHistory.length === 0) {
    historyEl.innerHTML = '<div class="history-empty">No execution history</div>';
  } else {
    historyEl.innerHTML = '';

    // Show last 20 items
    const start = Math.max(0, interpreter.executionHistory.length - 20);
    const history = interpreter.executionHistory.slice(start);

    history.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'history-item';

      // Highlight current instruction
      if (start + index === interpreter.executionHistory.length - 1) {
        item.classList.add('current');
      }

      const number = document.createElement('span');
      number.className = 'history-item-number';
      number.textContent = `${entry.ip}:`;

      const opcode = document.createElement('span');
      opcode.className = 'history-item-opcode';
      opcode.textContent = entry.opcode;
      opcode.title = entry.description;

      item.appendChild(number);
      item.appendChild(opcode);
      historyEl.appendChild(item);
    });

    // Auto-scroll to bottom
    historyEl.scrollTop = historyEl.scrollHeight;
  }
}

// Update execution state display
function updateExecutionState() {
  document.getElementById('ip-value').textContent = interpreter.ip;
  document.getElementById('total-instructions').textContent = interpreter.instructions.length;
  document.getElementById('executed-count').textContent = interpreter.executionHistory.length;
}

// Update status badge
function updateStatusBadge() {
  const badge = document.getElementById('exec-status');
  badge.className = 'status-badge';

  switch (interpreter.status) {
    case 'idle':
      badge.classList.add('status-idle');
      badge.textContent = 'Idle';
      break;
    case 'running':
      badge.classList.add('status-running');
      badge.textContent = 'Running';
      break;
    case 'success':
      badge.classList.add('status-success');
      badge.textContent = 'Success';
      break;
    case 'error':
      badge.classList.add('status-error');
      badge.textContent = 'Error';
      break;
  }

  if (executionMode === 'stepping') {
    badge.classList.add('status-running');
    badge.textContent = 'Stepping';
  }
}

// Highlight current instruction in editor
function highlightCurrentInstruction() {
  if (interpreter.ip >= interpreter.instructions.length) {
    return;
  }

  // Get the line number from the interpreter's line tracking
  const lineNumber = interpreter.instructionLines[interpreter.ip];

  if (lineNumber !== undefined && lineNumber !== null) {
    const monacoLine = lineNumber + 1; // Monaco uses 1-based line numbers

    // Highlight only the current line with a subtle left border
    const decorations = editor.deltaDecorations([], [
      {
        range: new monaco.Range(monacoLine, 1, monacoLine, 1),
        options: {
          isWholeLine: false,
          linesDecorationsClassName: 'current-line-glyph',
        }
      }
    ]);

    // Scroll to line
    editor.revealLineInCenter(monacoLine);

    // Store decorations for clearing later
    editor._currentDecorations = decorations;
  }
}

// Clear editor decorations
function clearDecorations() {
  if (editor._currentDecorations) {
    editor.deltaDecorations(editor._currentDecorations, []);
    editor._currentDecorations = null;
  }
}

// Console logging
function logToConsole(message, type = 'info') {
  const consoleEl = document.getElementById('console-output');
  const messageEl = document.createElement('div');
  messageEl.className = `console-message console-${type}`;

  const timestamp = new Date().toLocaleTimeString();
  messageEl.textContent = `[${timestamp}] ${message}`;

  consoleEl.appendChild(messageEl);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Clear console
function clearConsole() {
  const consoleEl = document.getElementById('console-output');
  consoleEl.innerHTML = '';
  logToConsole('Console cleared', 'info');
}

// File operations
async function confirmUnsavedChanges() {
  if (!hasUnsavedChanges) return true;
  return confirm('You have unsaved changes. Continue anyway?');
}

async function newFile() {
  if (!(await confirmUnsavedChanges())) return;

  editor.setValue(getDefaultScript());
  currentFilePath = null;
  hasUnsavedChanges = false;
  interpreter.reset();
  executionMode = 'idle';
  clearDecorations();
  updateUI();
  updateWindowTitle();
  logToConsole('New script created', 'info');
}

async function openFile() {
  if (!(await confirmUnsavedChanges())) return;

  try {
    const result = await window.electronAPI.loadFile();

    if (result.canceled) {
      return;
    }

    if (result.success) {
      editor.setValue(result.content);
      currentFilePath = result.filePath;
      hasUnsavedChanges = false;
      interpreter.reset();
      executionMode = 'idle';
      clearDecorations();
      updateUI();
      updateWindowTitle();
      logToConsole(`Loaded: ${result.filePath}`, 'success');
    } else {
      logToConsole(`Error loading file: ${result.error}`, 'error');
    }
  } catch (error) {
    logToConsole(`Error: ${error.message}`, 'error');
  }
}

async function saveFile() {
  try {
    const content = editor.getValue();
    const result = await window.electronAPI.saveFile({
      content,
      filePath: currentFilePath
    });

    if (result.canceled) {
      return;
    }

    if (result.success) {
      currentFilePath = result.filePath;
      hasUnsavedChanges = false;
      updateWindowTitle();
      logToConsole(`Saved: ${result.filePath}`, 'success');
    } else {
      logToConsole(`Error saving file: ${result.error}`, 'error');
    }
  } catch (error) {
    logToConsole(`Error: ${error.message}`, 'error');
  }
}

async function saveFileAs() {
  try {
    const content = editor.getValue();
    const result = await window.electronAPI.saveFile({
      content,
      filePath: null // Force save dialog
    });

    if (result.canceled) {
      return;
    }

    if (result.success) {
      currentFilePath = result.filePath;
      hasUnsavedChanges = false;
      updateWindowTitle();
      logToConsole(`Saved as: ${result.filePath}`, 'success');
    } else {
      logToConsole(`Error saving file: ${result.error}`, 'error');
    }
  } catch (error) {
    logToConsole(`Error: ${error.message}`, 'error');
  }
}

function showAbout() {
  logToConsole('SVSCRIPT - Bitcoin Script Interpreter and Debugger', 'info');
  logToConsole('Built with Electron and Monaco Editor', 'info');
}

function showKeyboardShortcuts() {
  const shortcuts = [
    'Cmd/Ctrl+N - New Script',
    'Cmd/Ctrl+O - Open Script',
    'Cmd/Ctrl+S - Save',
    'Cmd/Ctrl+Shift+S - Save As',
    'Cmd/Ctrl+Enter - Execute Script',
    'F10 - Step Through',
    'Cmd/Ctrl+R - Reset Execution',
    'Cmd/Ctrl+/ - Show Shortcuts'
  ];
  logToConsole('=== Keyboard Shortcuts ===', 'info');
  shortcuts.forEach(s => logToConsole(s, 'info'));
}

function updateWindowTitle() {
  const fileName = currentFilePath
    ? currentFilePath.split('/').pop().split('\\').pop()
    : 'Untitled';
  const dirty = hasUnsavedChanges ? '• ' : '';
  document.title = `${dirty}${fileName} - SVSCRIPT`;
}

// Help panel functions
async function showHelp() {
  try {
    // Load help markdown file
    const response = await fetch('help.md');
    const markdown = await response.text();

    // Convert markdown to HTML (simple conversion)
    const html = markdownToHtml(markdown);

    // Display in help panel
    document.getElementById('help-content').innerHTML = html;
    document.getElementById('help-panel').style.display = 'flex';
  } catch (error) {
    logToConsole(`Error loading help: ${error.message}`, 'error');
  }
}

function hideHelp() {
  document.getElementById('help-panel').style.display = 'none';
}

// Settings panel functions
function showSettings() {
  document.getElementById('settings-panel').style.display = 'flex';
}

function hideSettings() {
  document.getElementById('settings-panel').style.display = 'none';
}

function toggleSignatures(event) {
  settings.enableSignatures = event.target.checked;

  // Show/hide network settings
  const networkSettings = document.getElementById('network-settings');
  networkSettings.style.display = settings.enableSignatures ? 'block' : 'none';

  // Show/hide transaction context settings
  const txContextSettings = document.getElementById('tx-context-settings');
  txContextSettings.style.display = settings.enableSignatures ? 'block' : 'none';

  // Update interpreter settings
  if (interpreter) {
    interpreter.enableSignatures = settings.enableSignatures;
    interpreter.network = settings.network;
  }

  // Log status change
  const status = settings.enableSignatures ? 'enabled' : 'disabled';
  logToConsole(`Signature verification ${status}`, 'info');

  if (settings.enableSignatures) {
    logToConsole(`Network set to: ${settings.network}`, 'info');
    logToConsole('Note: checkSig/checkMultiSig require transaction context', 'warning');
    logToConsole('Note: checkDataSig works without transaction context', 'info');
  }
}

function changeNetwork(event) {
  settings.network = event.target.value;

  // Update interpreter settings
  if (interpreter) {
    interpreter.network = settings.network;
  }

  logToConsole(`Network changed to: ${settings.network}`, 'info');
}

// Chronicle release: Transaction version functions
function applyTransactionVersion() {
  const versionInput = document.getElementById('tx-version');
  const statusEl = document.getElementById('tx-version-status');
  const version = parseInt(versionInput.value);

  if (isNaN(version) || version < 1) {
    showTxVersionStatus('Invalid version. Must be a positive integer.', 'error');
    return;
  }

  settings.transactionVersion = version;

  // Update interpreter settings
  if (interpreter) {
    interpreter.transactionVersion = version;
  }

  const versionType = version > 1 ? 'Chronicle rules (relaxed malleability)' : 'Standard rules';
  showTxVersionStatus(`Transaction version set to ${version}`, 'success');
  logToConsole(`Transaction version changed to ${version} - ${versionType}`, 'info');
}

function showTxVersionStatus(message, type) {
  const statusEl = document.getElementById('tx-version-status');
  statusEl.textContent = message;
  statusEl.className = `settings-status visible ${type}`;

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusEl.className = 'settings-status';
    }, 3000);
  }
}

// Transaction context functions
function toggleTxContextMode(event) {
  const mode = event.target.value;
  const sighashSection = document.getElementById('sighash-input-section');
  const txSection = document.getElementById('transaction-input-section');

  if (mode === 'sighash') {
    sighashSection.style.display = 'block';
    txSection.style.display = 'none';
  } else {
    sighashSection.style.display = 'none';
    txSection.style.display = 'block';
  }
}

function applyTransactionContext() {
  const statusEl = document.getElementById('tx-context-status');
  const mode = document.querySelector('input[name="tx-context-mode"]:checked').value;

  try {
    if (mode === 'sighash') {
      const sighash = document.getElementById('sighash-input').value.trim();
      if (!sighash) {
        throw new Error('Sighash is required');
      }
      if (!/^[0-9a-fA-F]{64}$/.test(sighash)) {
        throw new Error('Sighash must be exactly 64 hex characters');
      }

      interpreter.setTransactionContext({ sighash: sighash });
      showTxContextStatus('Sighash context applied', 'success');
      logToConsole('Transaction context set: sighash mode', 'info');

    } else if (mode === 'transaction') {
      const txHex = document.getElementById('tx-hex-input').value.trim();
      const inputIndex = parseInt(document.getElementById('input-index').value);
      const prevScriptHex = document.getElementById('prev-script-hex').value.trim();
      const satoshis = parseInt(document.getElementById('prev-satoshis').value);

      if (!txHex) throw new Error('Transaction hex is required');
      if (!prevScriptHex) throw new Error('Previous output script is required');
      if (isNaN(inputIndex) || inputIndex < 0) throw new Error('Invalid input index');
      if (isNaN(satoshis) || satoshis < 0) throw new Error('Invalid satoshi amount');

      interpreter.setTransactionContext({
        txHex,
        inputIndex,
        prevScriptHex,
        satoshis
      });

      showTxContextStatus('Transaction context applied', 'success');
      logToConsole(`Transaction context set: full transaction mode (input ${inputIndex})`, 'info');
    }
  } catch (error) {
    showTxContextStatus(`Error: ${error.message}`, 'error');
    logToConsole(`Transaction context error: ${error.message}`, 'error');
  }
}

function clearTransactionContext() {
  interpreter.setTransactionContext(null);

  // Clear input fields
  document.getElementById('sighash-input').value = '';
  document.getElementById('tx-hex-input').value = '';
  document.getElementById('input-index').value = '0';
  document.getElementById('prev-script-hex').value = '';
  document.getElementById('prev-satoshis').value = '0';

  showTxContextStatus('Transaction context cleared', 'success');
  logToConsole('Transaction context cleared', 'info');
}

function showTxContextStatus(message, type) {
  const statusEl = document.getElementById('tx-context-status');
  statusEl.textContent = message;
  statusEl.className = `settings-status visible ${type}`;

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusEl.className = 'settings-status';
    }, 3000);
  }
}

// Simple markdown to HTML converter
function markdownToHtml(markdown) {
  let html = markdown;

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs
  html = html.split('\n\n').map(para => {
    // Don't wrap if already wrapped in a tag
    if (para.match(/^<[^>]+>/)) {
      return para;
    }
    return `<p>${para}</p>`;
  }).join('\n');

  return html;
}

// Error toast functions
function showErrorToast(errorMessage, instruction, lineNumber) {
  const toast = document.getElementById('error-toast');
  const messageEl = document.getElementById('error-toast-message');
  const locationEl = document.getElementById('error-toast-location');

  // Set error message
  messageEl.textContent = errorMessage;

  // Set location info
  if (lineNumber !== null && lineNumber !== undefined) {
    locationEl.innerHTML = `At line <strong>${lineNumber + 1}</strong>, instruction: <strong>${instruction}</strong>`;
  } else {
    locationEl.innerHTML = `Instruction: <strong>${instruction}</strong>`;
  }

  // Show toast
  toast.style.display = 'block';

  // Highlight error line in editor
  if (lineNumber !== null && lineNumber !== undefined) {
    highlightErrorLine(lineNumber);
  }
}

function hideErrorToast() {
  document.getElementById('error-toast').style.display = 'none';
  clearErrorHighlight();
}

function highlightErrorLine(lineNumber) {
  // Clear previous error highlighting
  clearErrorHighlight();

  // Add error line decoration (red background)
  errorLineDecoration = editor.deltaDecorations(errorLineDecoration, [
    {
      range: new monaco.Range(lineNumber + 1, 1, lineNumber + 1, 1),
      options: {
        isWholeLine: true,
        className: 'error-line-highlight',
        glyphMarginClassName: 'error-line-glyph'
      }
    }
  ]);

  // Scroll to error line
  editor.revealLineInCenter(lineNumber + 1);
}

function clearErrorHighlight() {
  errorLineDecoration = editor.deltaDecorations(errorLineDecoration, []);
}

// ==========================================
// Tools Panel Functions
// ==========================================

function showTools() {
  document.getElementById('tools-panel').style.display = 'flex';
}

function hideTools() {
  document.getElementById('tools-panel').style.display = 'none';
}

// Convert text to hexadecimal
function convertTextToHex() {
  const input = document.getElementById('text-to-hex-input').value;
  const output = document.getElementById('text-to-hex-output');

  if (!input) {
    output.value = '';
    return;
  }

  let hex = '';
  for (let i = 0; i < input.length; i++) {
    hex += input.charCodeAt(i).toString(16).padStart(2, '0');
  }

  output.value = hex;
  logToConsole(`Converted "${input}" to ${hex}`, 'info');
}

// Convert hexadecimal to text
function convertHexToText() {
  const input = document.getElementById('hex-to-text-input').value.trim();
  const output = document.getElementById('hex-to-text-output');

  if (!input) {
    output.value = '';
    return;
  }

  // Remove 0x prefix if present
  let hex = input;
  if (hex.toLowerCase().startsWith('0x')) {
    hex = hex.slice(2);
  }

  // Validate hex string
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    output.value = 'Error: Invalid hex characters';
    logToConsole('Hex to text conversion failed: invalid hex characters', 'error');
    return;
  }

  if (hex.length % 2 !== 0) {
    output.value = 'Error: Odd number of hex digits';
    logToConsole('Hex to text conversion failed: odd number of hex digits', 'error');
    return;
  }

  let text = '';
  for (let i = 0; i < hex.length; i += 2) {
    const charCode = parseInt(hex.substr(i, 2), 16);
    text += String.fromCharCode(charCode);
  }

  output.value = text;
  logToConsole(`Converted ${input} to "${text}"`, 'info');
}

// Calculate SHA256 hash
async function calculateSha256() {
  const input = document.getElementById('sha256-input').value;
  const output = document.getElementById('sha256-output');
  const mode = document.querySelector('input[name="sha256-mode"]:checked').value;

  if (!input) {
    output.value = '';
    return;
  }

  try {
    let dataToHash;

    if (mode === 'hex') {
      // Treat input as hex - remove 0x prefix if present
      let hex = input.trim();
      if (hex.toLowerCase().startsWith('0x')) {
        hex = hex.slice(2);
      }

      // Validate hex
      if (!/^[0-9a-fA-F]*$/.test(hex)) {
        output.value = 'Error: Invalid hex characters';
        logToConsole('SHA256 calculation failed: invalid hex characters', 'error');
        return;
      }

      if (hex.length % 2 !== 0) {
        output.value = 'Error: Odd number of hex digits';
        logToConsole('SHA256 calculation failed: odd number of hex digits', 'error');
        return;
      }

      // Convert hex to Uint8Array
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      dataToHash = bytes;
    } else {
      // Treat input as text - encode as UTF-8
      const encoder = new TextEncoder();
      dataToHash = encoder.encode(input);
    }

    // Use Web Crypto API to calculate SHA256
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    output.value = hashHex;
    logToConsole(`SHA256 (${mode}): ${hashHex}`, 'info');
  } catch (error) {
    output.value = 'Error: ' + error.message;
    logToConsole(`SHA256 calculation failed: ${error.message}`, 'error');
  }
}

// Copy to clipboard
async function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  const text = element.value;

  if (!text) {
    logToConsole('Nothing to copy', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    logToConsole('Copied to clipboard', 'success');

    // Visual feedback - briefly change button text
    const btn = element.parentElement.querySelector('button[id^="btn-copy"]');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1000);
    }
  } catch (error) {
    logToConsole('Failed to copy to clipboard', 'error');
  }
}

// Add CSS for line highlighting
const style = document.createElement('style');
style.textContent = `
  .current-line-glyph {
    background-color: #4ec9b0 !important;
    width: 4px !important;
    margin-left: 3px;
    border-radius: 2px;
  }
  .error-line-highlight {
    background-color: rgba(244, 135, 113, 0.2);
    border-left: 3px solid var(--accent-red);
  }
  .error-line-glyph {
    background-color: var(--accent-red) !important;
    width: 4px !important;
    margin-left: 3px;
    border-radius: 2px;
  }
`;
document.head.appendChild(style);
