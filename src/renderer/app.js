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

let currentView = 'script'; // 'script', 'hex', 'asm'

// Settings
let settings = {
  enableSignatures: false,
  network: 'mainnet',
  txVersion: 1,
  substitutePreimage: true,
  aiProvider: 'claude',
  aiApiKey: '',
  aiModel: ''
};

// AI chat state
let aiMessages = []; // conversation history for API calls
let aiLoading = false;

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
    window.electronAPI.onMenuAction('menu-verify-script', verifyScript);
    window.electronAPI.onMenuAction('menu-deploy-script', showDeploy);
    window.electronAPI.onMenuAction('menu-open-chain', openChainProject);
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

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
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

  // View toggle buttons
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Verify button
  document.getElementById('btn-verify').addEventListener('click', verifyScript);

  // Chain mode
  document.getElementById('btn-chain-mode').addEventListener('click', function() {
    if (chainModeActive) {
      toggleChainMode(false);
    } else if (chainEngine.project) {
      toggleChainMode(true);
    } else {
      openChainProject();
    }
  });
  document.getElementById('btn-chain-run').addEventListener('click', runChainTransition);
  document.getElementById('btn-chain-reset').addEventListener('click', resetChainState);
  document.getElementById('chain-method-select').addEventListener('change', renderMethodParams);

  // Settings event listeners
  document.getElementById('enable-signatures').addEventListener('change', toggleSignatures);
  document.querySelectorAll('input[name="network"]').forEach(radio => {
    radio.addEventListener('change', changeNetwork);
  });
  document.querySelectorAll('input[name="tx-version"]').forEach(radio => {
    radio.addEventListener('change', changeTxVersion);
  });
  document.getElementById('substitute-preimage')
    .addEventListener('change', toggleSubstitutePreimage);

  // Transaction context event listeners
  document.querySelectorAll('input[name="tx-context-mode"]').forEach(radio => {
    radio.addEventListener('change', toggleTxContextMode);
  });
  document.getElementById('btn-apply-tx-context').addEventListener('click', applyTransactionContext);
  document.getElementById('btn-clear-tx-context').addEventListener('click', clearTransactionContext);

  // Preimage computation
  document.getElementById('btn-compute-preimage').addEventListener('click', computePreimage);
  document.getElementById('btn-inject-preimage').addEventListener('click', injectPreimageToStack);

  // Update stack preview when input changes
  const stackInput = document.getElementById('initial-stack-input');
  stackInput.addEventListener('input', updateStackPreview);

  // Initialize empty preview
  updateStackPreview();

  // AI panel event listeners
  document.getElementById('btn-ai').addEventListener('click', showAI);
  document.getElementById('btn-close-ai').addEventListener('click', hideAI);
  document.getElementById('btn-ai-send').addEventListener('click', sendAIMessage);
  document.getElementById('btn-ai-clear').addEventListener('click', clearAIChat);
  document.getElementById('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendAIMessage();
    }
  });
  document.querySelectorAll('.ai-action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAIQuickAction(btn.dataset.action));
  });
  document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
    radio.addEventListener('change', (e) => { settings.aiProvider = e.target.value; });
  });
  document.getElementById('ai-api-key').addEventListener('change', (e) => {
    settings.aiApiKey = e.target.value.trim();
  });
  document.getElementById('ai-model').addEventListener('change', (e) => {
    settings.aiModel = e.target.value.trim();
  });

  // Deploy panel event listeners
  document.getElementById('btn-deploy').addEventListener('click', showDeploy);
  document.getElementById('btn-close-deploy').addEventListener('click', hideDeploy);
  document.getElementById('deploy-wif').addEventListener('input', debounce(onDeployWifChange, 500));
  document.getElementById('btn-refresh-balance').addEventListener('click', refreshDeployBalance);
  document.getElementById('btn-deploy-execute').addEventListener('click', executeDeployment);
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

  const items = splitStackInput(input);

  if (items.length === 0) {
    replaceWithPlaceholder(previewContainer, 'stack-empty', 'No initial values');
    return;
  }

  // Parse and display stack (reversed to show top to bottom).
  previewContainer.textContent = '';
  [...items].reverse().forEach((value, index) => {
    const actualIndex = items.length - 1 - index;
    const parsed = parseStackItem(value);
    const type = parsed.error ? 'invalid' : parsed.type;

    previewContainer.appendChild(elementWithSpans('div', 'stack-preview-item', [
      ['stack-preview-index', `[${actualIndex}]`],
      ['stack-preview-value', value],
      ['stack-preview-type', type]
    ]));
  });
}

// Get initial stack values from input
function getInitialStackValues() {
  const input = document.getElementById('initial-stack-input').value;
  const values = [];

  for (const item of splitStackInput(input)) {
    const parsed = parseStackItem(item);
    if (parsed.error) {
      logToConsole(parsed.error, 'error');
      continue;
    }
    values.push(parsed.value);
  }

  return values;
}

// In chain mode the stack is derived from the chain state, not the input panel
async function resolveInitialStack() {
  if (typeof chainModeActive !== 'undefined' && chainModeActive) {
    const run = await prepareChainRun();
    if (run) return run.initialStack;
    logToConsole('Falling back to the manual initial stack', 'warning');
  }
  return getInitialStackValues();
}

// Run entire script. run-lock.js lets one run through at a time.
async function runScript() {
  await runExclusive(runScriptNow);
}

async function runScriptNow() {
  const script = editor.getValue();

  if (!script.trim()) {
    logToConsole('No script to execute', 'warning');
    return;
  }

  // A full run replaces any step run in progress, so the badge and the next
  // Step must not carry on as if it were still stepping
  executionMode = 'idle';

  try {
    logToConsole('Executing script...', 'info');
    clearDecorations();
    hideErrorToast(); // Clear any previous errors

    // Get initial stack values
    const initialStack = await resolveInitialStack();
    if (initialStack.length > 0) {
      logToConsole(`Initial stack: [${initialStack.join(', ')}]`, 'info');
    }

    const result = await interpreter.run(script, initialStack, currentFilePath);

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
  } finally {
    // In chain mode the run borrowed the transaction context
    restoreChainContext();
  }
}

// Step through script one instruction at a time. In chain mode the step run
// borrows the transaction context until it goes back to idle.
async function stepScript() {
  await runExclusive(async () => {
    try {
      await stepOnce();
    } finally {
      if (executionMode === 'idle') restoreChainContext();
    }
  });
}

async function stepOnce() {
  if (executionMode === 'idle') {
    // Start stepping mode
    const script = editor.getValue();
    if (!script.trim()) {
      logToConsole('No script to execute', 'warning');
      return;
    }

    // Get initial stack values
    const initialStack = await resolveInitialStack();
    if (initialStack.length > 0) {
      logToConsole(`Initial stack: [${initialStack.join(', ')}]`, 'info');
    }

    await interpreter.parse(script, initialStack, currentFilePath);
    executionMode = 'stepping';
    logToConsole('Stepping mode started', 'info');
  }

  if (executionMode === 'stepping') {
    if (interpreter.ip >= interpreter.instructions.length) {
      // Stepping past the last instruction is where the interpreter applies
      // the clean-stack and truthiness rules, so let it answer here too
      try {
        await interpreter.step();
        logToConsole('Script execution completed', 'success');
        logToConsole(`Final stack: [${interpreter.mainStack.join(', ')}]`, 'info');
      } catch (error) {
        logToConsole(`Error: ${error.message}`, 'error');
        showErrorToast(interpreter.error || error.message,
          interpreter.errorInstruction || 'unknown', interpreter.errorLine);
      }
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
  restoreChainContext();
  clearDecorations();
  hideErrorToast(); // Clear any error messages
  updateUI();
  logToConsole('Script reset', 'info');
}

// Switch between script, hex, and asm views
function switchView(view) {
  currentView = view;

  // Update toggle button states
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const editorContainer = document.getElementById('editor-container');
  const compiledOutput = document.getElementById('compiled-output');
  const compiledContent = document.getElementById('compiled-output-content');

  if (view === 'script') {
    editorContainer.style.display = 'block';
    compiledOutput.style.display = 'none';
    return;
  }

  // Compile the current script
  try {
    const tempInterpreter = new ScriptInterpreter();
    const script = editor.getValue();
    const parsePromise = tempInterpreter.parse(script, [], currentFilePath);
    parsePromise.then(() => {
      const instructions = tempInterpreter.instructions;
      const hex = compileInstructionsToHex(instructions);

      if (view === 'hex') {
        // Display hex in rows of 32 bytes (64 chars)
        let formatted = '';
        for (let i = 0; i < hex.length; i += 64) {
          const offset = (i / 2).toString(16).padStart(6, '0');
          formatted += offset + '  ' + hex.slice(i, i + 64) + '\n';
        }
        compiledContent.textContent = formatted || '(empty script)';
      } else if (view === 'asm') {
        compiledContent.textContent = disassemble(hex) || '(empty script)';
      }

      editorContainer.style.display = 'none';
      compiledOutput.style.display = 'block';
    }).catch(err => {
      compiledContent.textContent = 'Compilation error: ' + err.message;
      editorContainer.style.display = 'none';
      compiledOutput.style.display = 'block';
    });
  } catch (err) {
    compiledContent.textContent = 'Compilation error: ' + err.message;
    editorContainer.style.display = 'none';
    compiledOutput.style.display = 'block';
  }
}

// Verify script against Rúnar ScriptVM
async function verifyScript() {
  await runExclusive(verifyScriptNow);
}

async function verifyScriptNow() {
  const script = editor.getValue();
  if (!script.trim()) {
    logToConsole('No script to verify', 'warning');
    return;
  }

  try {
    logToConsole('Verifying script against Rúnar ScriptVM...', 'info');

    // Step 1: Compile, and decide what the comparison can honestly claim.
    // A script that does not compile has nothing to hand the ScriptVM.
    let scriptHex;
    try {
      const tempInterpreter = new ScriptInterpreter();
      await tempInterpreter.parse(script, [], currentFilePath);
      scriptHex = compileInstructionsToHex(tempInterpreter.instructions);
    } catch (error) {
      logToConsole(`The script does not compile, so nothing was compared: ${error.message}`, 'error');
      return;
    }

    let restoreContext = null;
    const plan = planVerification(scriptHex, {
      bindingHex: CHECK_PREIMAGE_BINDING_HEX,
      substitutePreimage: settings.substitutePreimage,
      enableSignatures: settings.enableSignatures
    });

    if (!plan.compare) {
      logToConsole(`Not compared: ${plan.reason}.`, 'warning');
      return;
    }

    if (!window.runar || !window.runar.verifyScript) {
      logToConsole('Rúnar ScriptVM not available: the preload bridge is missing.', 'error');
      return;
    }

    // Step 2: The ScriptVM runs the binding against a transaction of its own,
    // so the preimage on the stack has to be that transaction's preimage or
    // neither engine is checking anything real.
    const initialStack = getInitialStackValues();

    if (plan.substitutePreimage) {
      const derived = await window.runar.verifyPreimage(scriptHex);
      if (!derived.success) {
        logToConsole(`Could not derive a preimage for this script: ${derived.error}`, 'error');
        return;
      }

      if (initialStack.length === 0) {
        initialStack.push('0x' + derived.preimageHex);
      } else {
        initialStack[initialStack.length - 1] = '0x' + derived.preimageHex;
      }

      // Verify borrows the context; whatever the settings configured goes back
      restoreContext = { context: interpreter.txContext, mode: interpreter.txContextMode };
      interpreter.setTransactionContext({ sighash: derived.sighashHex });
      logToConsole('Substituted a preimage matching the verification transaction, ' +
        'because the binding rejects any other one in both engines', 'info');
    }

    // Step 3: Run through our interpreter. This ends any step run in
    // progress, so the next Step starts a fresh one.
    executionMode = 'idle';
    const localResult = await interpreter.run(script, initialStack, currentFilePath);
    const localStack = [...interpreter.mainStack];
    const localSuccess = localResult.success;

    // Step 4: Same stack to the ScriptVM, converted the way the interpreter does
    const initialStackHex = initialStack.map(v => interpreter.toHexString(v));
    const vmResult = await window.runar.verifyScript(scriptHex, initialStackHex, settings.txVersion);

    if (vmResult.error && vmResult.error.includes('not available')) {
      logToConsole('Rúnar ScriptVM not available: ' + vmResult.error, 'error');
      return;
    }

    // Step 5: Compare results
    logToConsole('=== Verification Results ===', 'info');
    logToConsole(`Local interpreter: ${localSuccess ? 'SUCCESS' : 'FAILED'} | Stack: [${localStack.join(', ')}]`, localSuccess ? 'success' : 'error');
    logToConsole(`Rúnar ScriptVM:    ${vmResult.success ? 'SUCCESS' : 'FAILED'} | Stack: [${vmResult.stack.join(', ')}]`, vmResult.success ? 'success' : 'error');

    if (vmResult.opsExecuted !== undefined) {
      logToConsole(`ScriptVM stats: ${vmResult.opsExecuted} ops executed, max stack depth: ${vmResult.maxStackDepth}`, 'info');
    }

    if (vmResult.vmError) {
      logToConsole(`ScriptVM error: ${vmResult.vmError}`, 'warning');
    }

    // Compare verdicts and final stacks
    const outcome = verifyVerdict(
      { success: localSuccess, error: localResult.error, stackHex: localStack.map(v => interpreter.toHexString(v)) },
      { success: vmResult.success, error: vmResult.vmError, stackHex: vmResult.stack });
    logToConsole('Result: ' + outcome.message,
      { MATCH: 'success', BOTH_FAILED: 'warning', MISMATCH: 'error' }[outcome.verdict]);

    // Reset interpreter state (verification is non-destructive to UI)
    interpreter.reset();
    if (restoreContext) {
      interpreter.txContext = restoreContext.context;
      interpreter.txContextMode = restoreContext.mode;
    }
    updateUI();

  } catch (error) {
    logToConsole(`Verification error: ${error.message}`, 'error');
  } finally {
    // Only matters when Verify cut a chain-mode step run short
    if (executionMode === 'idle') restoreChainContext();
  }
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
      type.textContent = stackValueType(value);

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
      type.textContent = stackValueType(value);

      item.appendChild(index);
      item.appendChild(valueSpan);
      item.appendChild(type);
      altStackEl.appendChild(item);
    }
  }
}

// Format stack values for display
// A script number is a bigint, which the panel calls a number, and bytes are
// the 0x-prefixed strings.
function stackValueType(value) {
  if (typeof value === 'bigint') return 'number';
  if (typeof value === 'string' && value.startsWith('0x')) return 'hex';
  return typeof value;
}

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
  toggleChainMode(false);
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
      toggleChainMode(false);
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
    'Cmd/Ctrl+Shift+V - Verify with ScriptVM',
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
    logToConsole('Note: checkSig/checkMultiSig require transaction context', 'warning');
  }
}

function changeNetwork(event) {
  settings.network = event.target.value;

  // Update interpreter settings
  if (interpreter) {
    interpreter.network = settings.network;
  }

  // The Deploy panel shows the network, and the address format depends on it
  document.getElementById('deploy-network-value').textContent = settings.network;
  onDeployWifChange();

  logToConsole(`Network changed to: ${settings.network}`, 'info');
}

function toggleSubstitutePreimage(event) {
  settings.substitutePreimage = event.target.checked;
  logToConsole(settings.substitutePreimage
    ? 'Verify will substitute a preimage that matches the verification transaction'
    : 'Verify will skip any script that needs a substituted preimage', 'info');
}

// Transaction version decides the strict rules, so the interpreter needs it
function changeTxVersion(event) {
  settings.txVersion = Number(event.target.value);

  if (interpreter) {
    interpreter.txVersion = settings.txVersion;
  }

  logToConsole(`Transaction version set to ${settings.txVersion} ` +
    `(${settings.txVersion > 1 ? 'relaxed' : 'strict'} rules)`, 'info');
}

// Transaction context functions
function toggleTxContextMode(event) {
  const mode = event.target.value;
  const sighashSection = document.getElementById('sighash-input-section');
  const txSection = document.getElementById('transaction-input-section');
  const preimageSection = document.getElementById('preimage-input-section');

  sighashSection.style.display = mode === 'sighash' ? 'block' : 'none';
  txSection.style.display = mode === 'transaction' ? 'block' : 'none';
  preimageSection.style.display = mode === 'preimage' ? 'block' : 'none';
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

  // Set location info. `instruction` is a token out of the script under test,
  // so build the line rather than interpolating it into markup.
  locationEl.textContent = '';
  const strong = (text) => {
    const el = document.createElement('strong');
    el.textContent = text;
    return el;
  };
  if (lineNumber !== null && lineNumber !== undefined) {
    locationEl.appendChild(document.createTextNode('At line '));
    locationEl.appendChild(strong(String(lineNumber + 1)));
    locationEl.appendChild(document.createTextNode(', instruction: '));
  } else {
    locationEl.appendChild(document.createTextNode('Instruction: '));
  }
  locationEl.appendChild(strong(String(instruction)));

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

// ---------------------------------------------------------------------------
// Deploy Panel Functions
// ---------------------------------------------------------------------------

function showDeploy() {
  const panel = document.getElementById('deploy-panel');
  panel.style.display = 'flex';
  // Update network display from current settings
  document.getElementById('deploy-network-value').textContent = settings.network;
}

function hideDeploy() {
  document.getElementById('deploy-panel').style.display = 'none';
}

async function onDeployWifChange() {
  const wif = document.getElementById('deploy-wif').value.trim();
  const addressDisplay = document.getElementById('deploy-address');
  const fundingSection = document.getElementById('deploy-funding-section');
  const actionSection = document.getElementById('deploy-action-section');

  if (!wif || wif.length < 50) {
    addressDisplay.style.display = 'none';
    fundingSection.style.display = 'none';
    actionSection.style.display = 'none';
    return;
  }

  try {
    const result = await window.runar.getAddress(wif, settings.network);
    if (result.success) {
      document.getElementById('deploy-address-value').textContent = result.address;
      addressDisplay.style.display = 'flex';
      fundingSection.style.display = 'block';
      actionSection.style.display = 'block';

      // Auto-fetch balance
      await refreshDeployBalance();
    } else {
      addressDisplay.style.display = 'none';
      fundingSection.style.display = 'none';
      actionSection.style.display = 'none';
      logToConsole('Invalid WIF key: ' + result.error, 'error');
    }
  } catch (err) {
    logToConsole('Error deriving address: ' + err.message, 'error');
  }
}

async function refreshDeployBalance() {
  const address = document.getElementById('deploy-address-value').textContent;
  if (!address) return;

  document.getElementById('deploy-balance-value').textContent = 'Loading...';

  try {
    const result = await window.runar.getBalance(address, settings.network);
    if (result.success) {
      document.getElementById('deploy-balance-value').textContent =
        `${result.balance.toLocaleString()} sats (${result.utxoCount} UTXOs)`;
    } else {
      document.getElementById('deploy-balance-value').textContent = 'Error: ' + result.error;
    }
  } catch (err) {
    document.getElementById('deploy-balance-value').textContent = 'Error: ' + err.message;
  }
}

// ---------------------------------------------------------------------------
// AI Assistant Panel Functions
// ---------------------------------------------------------------------------

function showAI() {
  document.getElementById('ai-panel').style.display = 'flex';
}

function hideAI() {
  document.getElementById('ai-panel').style.display = 'none';
}

function clearAIChat() {
  aiMessages = [];
  const container = document.getElementById('ai-messages');
  container.textContent = '';

  const message = document.createElement('div');
  message.className = 'ai-message ai-message-assistant';
  const content = document.createElement('div');
  content.className = 'ai-message-content';
  content.textContent = 'I can help you write, explain, and fix Bitcoin Scripts. ' +
    'Ask me anything or use the quick actions above.';
  message.appendChild(content);
  container.appendChild(message);
}

function handleAIQuickAction(action) {
  const script = editor.getValue().trim();
  let prompt;

  switch (action) {
    case 'explain':
      if (!script) {
        appendAIMessage('assistant', 'There is no script in the editor to explain. Write or load a script first.');
        return;
      }
      prompt = 'Explain what this script does step by step, showing how the stack changes at each instruction.';
      break;
    case 'fix':
      if (!script) {
        appendAIMessage('assistant', 'There is no script in the editor to fix. Write or load a script first.');
        return;
      }
      prompt = 'Check this script for errors or issues and provide a corrected version if needed.';
      break;
    case 'optimize':
      if (!script) {
        appendAIMessage('assistant', 'There is no script in the editor to optimize. Write or load a script first.');
        return;
      }
      prompt = 'Suggest optimizations to make this script more efficient (fewer opcodes, less stack manipulation).';
      break;
    default:
      return;
  }

  // Set the prompt in the input and send
  document.getElementById('ai-input').value = prompt;
  sendAIMessage();
}

async function sendAIMessage() {
  if (aiLoading) return;

  const input = document.getElementById('ai-input');
  const userText = input.value.trim();
  if (!userText) return;

  // Clear input
  input.value = '';

  // Add user message to UI
  appendAIMessage('user', userText);

  // Add to conversation history
  aiMessages.push({ role: 'user', content: userText });

  // Show loading
  aiLoading = true;
  const sendBtn = document.getElementById('btn-ai-send');
  sendBtn.disabled = true;
  sendBtn.textContent = '...';
  const loadingEl = appendAIMessage('assistant', 'Thinking...', true);

  try {
    const result = await window.ai.chat({
      provider: settings.aiProvider,
      apiKey: settings.aiApiKey,
      model: settings.aiModel || undefined,
      messages: aiMessages,
      editorContent: editor.getValue()
    });

    // Remove loading message
    loadingEl.remove();

    if (result.success) {
      aiMessages.push({ role: 'assistant', content: result.reply });
      appendAIMessage('assistant', result.reply);
    } else {
      appendAIMessage('assistant', 'Error: ' + result.error);
    }
  } catch (err) {
    loadingEl.remove();
    appendAIMessage('assistant', 'Error: ' + err.message);
  } finally {
    aiLoading = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }
}

function appendAIMessage(role, content, isLoading) {
  const container = document.getElementById('ai-messages');
  const msgEl = document.createElement('div');
  msgEl.className = `ai-message ai-message-${role}`;
  if (isLoading) msgEl.classList.add('ai-message-loading');

  const contentEl = document.createElement('div');
  contentEl.className = 'ai-message-content';

  if (role === 'assistant' && !isLoading) {
    contentEl.innerHTML = renderAIMarkdown(content);
    // Add "Insert to Editor" buttons for code blocks
    contentEl.querySelectorAll('pre code').forEach(codeEl => {
      const btn = document.createElement('button');
      btn.className = 'ai-insert-btn';
      btn.textContent = 'Insert to Editor';
      btn.addEventListener('click', () => {
        editor.setValue(codeEl.textContent);
        logToConsole('Script inserted from AI assistant', 'info');
      });
      codeEl.parentElement.appendChild(btn);
    });
  } else {
    contentEl.textContent = content;
  }

  msgEl.appendChild(contentEl);
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
  return msgEl;
}

function renderAIMarkdown(text) {
  // Escape the whole reply first, then add the formatting tags. Escaping only
  // the code spans left every other part of the reply able to inject markup.
  let html = escapeHtml(text);

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Line breaks -> paragraphs
  html = html.split('\n\n').map(para => {
    if (para.match(/^<(pre|ul|ol|h[1-3])/)) return para;
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

// ---------------------------------------------------------------------------
// Deploy Panel Functions (continued)
// ---------------------------------------------------------------------------

let deployInFlight = false;

async function executeDeployment() {
  // A second click while the first is still broadcasting would spend twice
  if (deployInFlight) return;

  const wif = document.getElementById('deploy-wif').value.trim();
  const satoshis = parseInt(document.getElementById('deploy-satoshis').value);
  const statusEl = document.getElementById('deploy-status');
  const resultEl = document.getElementById('deploy-result');

  if (!wif) {
    statusEl.textContent = 'WIF key is required';
    statusEl.className = 'settings-status visible error';
    return;
  }

  if (isNaN(satoshis) || satoshis < 1) {
    statusEl.textContent = 'Minimum 1 satoshi';
    statusEl.className = 'settings-status visible error';
    return;
  }

  const deployBtn = document.getElementById('btn-deploy-execute');
  deployInFlight = true;
  deployBtn.disabled = true;

  // Compile current script to hex
  try {
    statusEl.textContent = 'Compiling script...';
    statusEl.className = 'settings-status visible';

    const script = editor.getValue();
    const tempInterpreter = new ScriptInterpreter();
    await tempInterpreter.parse(script, [], currentFilePath);
    const scriptHex = compileInstructionsToHex(tempInterpreter.instructions);

    if (!scriptHex) {
      statusEl.textContent = 'Nothing to deploy: the script is empty';
      statusEl.className = 'settings-status visible error';
      return;
    }

    // ponytail: native confirm() is enough for the one irreversible action
    if (settings.network === 'mainnet' &&
        !confirm(`Deploy to MAINNET?\n\nThis broadcasts a real transaction locking ${satoshis} ` +
          `satoshis in a ${scriptHex.length / 2}-byte script. It cannot be undone.`)) {
      statusEl.textContent = 'Deployment cancelled';
      return;
    }

    statusEl.textContent = 'Deploying to ' + settings.network + '...';

    const result = await window.runar.deployScript({
      wif,
      scriptHex,
      satoshis,
      network: settings.network
    });

    if (result.success) {
      statusEl.textContent = 'Deployed successfully!';
      statusEl.className = 'settings-status visible success';

      document.getElementById('deploy-txid').value = result.txid;
      resultEl.style.display = 'block';

      // Show explorer link
      const baseUrl = settings.network === 'testnet'
        ? 'https://test.whatsonchain.com/tx/'
        : 'https://whatsonchain.com/tx/';
      const link = document.getElementById('deploy-explorer-link');
      link.href = baseUrl + result.txid;
      link.style.display = 'inline-block';

      logToConsole(`Script deployed! TxID: ${result.txid}`, 'success');

      // Refresh balance
      await refreshDeployBalance();
    } else {
      statusEl.textContent = 'Deployment failed: ' + result.error;
      statusEl.className = 'settings-status visible error';
      logToConsole('Deployment failed: ' + result.error, 'error');
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'settings-status visible error';
    logToConsole('Deployment error: ' + err.message, 'error');
  } finally {
    deployInFlight = false;
    deployBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Preimage (OP_PUSH_TX) Functions
// ---------------------------------------------------------------------------

async function computePreimage() {
  const statusEl = document.getElementById('preimage-status');
  const resultsEl = document.getElementById('preimage-results');
  const injectBtn = document.getElementById('btn-inject-preimage');

  const txHex = document.getElementById('preimage-tx-hex').value.trim();
  const inputIndex = parseInt(document.getElementById('preimage-input-index').value);
  const lockingScriptHex = document.getElementById('preimage-locking-script').value.trim();
  const satoshis = parseInt(document.getElementById('preimage-satoshis').value);

  if (!txHex) {
    statusEl.textContent = 'Spending transaction hex is required';
    statusEl.className = 'settings-status visible error';
    return;
  }
  if (!lockingScriptHex) {
    statusEl.textContent = 'Locking script hex is required';
    statusEl.className = 'settings-status visible error';
    return;
  }
  if (isNaN(satoshis) || satoshis <= 0) {
    statusEl.textContent = 'Valid satoshi amount is required';
    statusEl.className = 'settings-status visible error';
    return;
  }

  statusEl.textContent = 'Computing preimage...';
  statusEl.className = 'settings-status visible';

  try {
    // Find the last OP_CODESEPARATOR in the locking script, stepping over
    // push data: a 0xab byte inside a push is not a separator
    const codeSeparatorIndex = lastCodeSeparatorIndex(hexToBytes(lockingScriptHex));

    const result = await window.runar.computePreimage({
      txHex,
      inputIndex,
      lockingScriptHex,
      satoshis,
      codeSeparatorIndex
    });

    if (result.success) {
      document.getElementById('preimage-sig-output').value = result.sigHex;
      document.getElementById('preimage-hex-output').value = result.preimageHex;
      resultsEl.style.display = 'block';
      injectBtn.style.display = 'inline-block';
      statusEl.textContent = 'Preimage computed successfully';
      statusEl.className = 'settings-status visible success';
      logToConsole('OP_PUSH_TX preimage computed. Signature: ' + result.sigHex.substring(0, 20) + '...', 'success');
    } else {
      statusEl.textContent = 'Error: ' + result.error;
      statusEl.className = 'settings-status visible error';
      logToConsole('Preimage computation failed: ' + result.error, 'error');
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'settings-status visible error';
    logToConsole('Preimage computation error: ' + err.message, 'error');
  }
}

function injectPreimageToStack() {
  const sigHex = document.getElementById('preimage-sig-output').value;
  const preimageHex = document.getElementById('preimage-hex-output').value;

  if (!sigHex || !preimageHex) {
    logToConsole('No preimage data to inject. Compute preimage first.', 'warning');
    return;
  }

  // Set the initial stack input: signature at bottom, preimage on top
  const stackInput = document.getElementById('initial-stack-input');
  stackInput.value = '0x' + sigHex + ' 0x' + preimageHex;
  updateStackPreview();

  logToConsole('Injected OP_PUSH_TX signature and preimage to initial stack', 'success');

  // Close the settings panel for convenience
  hideSettings();
}
