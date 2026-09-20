var chainEngine = new ChainEngine();
var chainModeActive = false;
// The contract file of the loaded project. The Chain Mode button goes back
// into chain mode only while the editor still holds this file.
var chainContractPath = null;

// The interpreter's transaction context as Settings left it, held while a
// chain run borrows the interpreter, so the run can put it back
var chainBorrowedContext = null;

function restoreChainContext() {
  if (!chainBorrowedContext) return;
  interpreter.txContext = chainBorrowedContext.context;
  interpreter.txContextMode = chainBorrowedContext.mode;
  chainBorrowedContext = null;
}

function clearNewStateInput() {
  var newStateInput = document.getElementById('chain-new-state-input');
  if (newStateInput) newStateInput.value = '';
}

function toggleChainMode(enabled) {
  chainModeActive = enabled;
  var stackPanel = document.getElementById('panel-stack-input');
  var chainPanel = document.getElementById('chain-panel-main');
  var chainToggle = document.getElementById('btn-chain-mode');

  if (enabled) {
    stackPanel.style.display = 'none';
    chainPanel.style.display = 'flex';
    if (chainToggle) chainToggle.classList.add('active');
  } else {
    restoreChainContext();
    stackPanel.style.display = 'flex';
    chainPanel.style.display = 'none';
    if (chainToggle) chainToggle.classList.remove('active');
  }
}

async function openChainProject() {
  try {
    if (!(await confirmUnsavedChanges())) return;

    // Open file dialog filtered for JSON files
    var dialogResult = await window.electronAPI.openChainDialog();
    if (!dialogResult.success || dialogResult.canceled) return;

    var loadResult = await window.electronAPI.loadChainProject(dialogResult.filePath);
    if (!loadResult.success) {
      logToConsole('Failed to load chain project: ' + loadResult.error, 'error');
      return;
    }

    chainEngine.loadProject(loadResult.project, loadResult.bscriptFiles);

    // Switch to chain mode
    toggleChainMode(true);

    // Load the contract source into the editor
    var contractSrc = loadResult.bscriptFiles[loadResult.project.contract] || '';
    editor.setValue(contractSrc);
    // The editor holds the contract, so Save must write the contract file,
    // not the .bsm.json the dialog picked
    currentFilePath = loadResult.contractPath;
    chainContractPath = loadResult.contractPath;
    hasUnsavedChanges = false;
    updateWindowTitle();
    clearNewStateInput();

    // Render the chain panel
    renderChainPanel();

    logToConsole('Chain project loaded: ' + loadResult.project.name, 'success');
    logToConsole('State fields: ' + chainEngine.project.stateFields.map(function(f) { return f.name; }).join(', '), 'info');
    logToConsole('Methods: ' + chainEngine.project.methods.map(function(m) { return m.name; }).join(', '), 'info');
  } catch (err) {
    logToConsole('Error loading chain project: ' + err.message, 'error');
  }
}

function renderChainPanel() {
  if (!chainEngine.project) return;

  var project = chainEngine.project;

  // Render project header
  document.getElementById('chain-project-name').textContent = project.name || 'Unnamed';

  // Render state fields
  renderStateFields();

  // Render method selector
  renderMethodSelector();

  // Render chain history
  renderChainHistory();

  // Update step count
  document.getElementById('chain-step-count').textContent = 'Step ' + chainEngine.stepCount;
}

// Every value below comes from a .bsm.json the user opened. Field names,
// types and state values are untrusted, so they go in as text nodes, never
// as markup.
function renderStateFields() {
  var container = document.getElementById('chain-state-fields');
  var fields = chainEngine.project.stateFields;
  var state = chainEngine.currentState;

  if (!fields || fields.length === 0) {
    replaceWithPlaceholder(container, 'stack-empty', 'No state fields');
    return;
  }

  container.textContent = '';
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var val = state[f.name];
    var displayVal = val !== undefined && val !== null ? String(val) : '';
    if (displayVal.length > 30) displayVal = displayVal.substring(0, 30) + '...';

    container.appendChild(elementWithSpans('div', 'chain-field', [
      ['chain-field-name', f.name],
      ['chain-field-type', f.type],
      ['chain-field-value', displayVal]
    ]));
  }
}

function renderMethodSelector() {
  var select = document.getElementById('chain-method-select');
  var methods = chainEngine.project.methods;

  select.textContent = '';
  for (var i = 0; i < methods.length; i++) {
    var m = methods[i];
    var option = document.createElement('option');
    option.value = m.name;
    option.textContent = m.name + (m.terminal ? ' (terminal)' : '');
    select.appendChild(option);
  }

  // Render params for selected method
  renderMethodParams();
}

function renderMethodParams() {
  var container = document.getElementById('chain-method-params');
  var methodName = document.getElementById('chain-method-select').value;
  var method = chainEngine.getMethod(methodName);
  if (!method) return;

  if (!method.params || method.params.length === 0) {
    replaceWithPlaceholder(container, 'stack-empty', 'No parameters (auto-injected preimage only)');
    return;
  }

  container.textContent = '';
  for (var i = 0; i < method.params.length; i++) {
    var p = method.params[i];

    var wrapper = document.createElement('div');
    wrapper.className = 'chain-param';

    var label = document.createElement('label');
    label.className = 'chain-param-label';
    label.textContent = p.name + ' (' + p.type + ')';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'chain-param-input settings-text-input';
    input.dataset.param = p.name;
    input.placeholder = p.type + ' value...';

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  }
}

function renderChainHistory() {
  var container = document.getElementById('chain-history');
  var history = chainEngine.history;

  if (history.length === 0) {
    replaceWithPlaceholder(container, 'stack-empty', 'No transitions yet');
    return;
  }

  container.textContent = '';
  for (var i = 0; i < history.length; i++) {
    var h = history[i];
    var stateStr = h.newState ? JSON.stringify(h.newState) : '(terminated)';
    if (stateStr.length > 50) stateStr = stateStr.substring(0, 50) + '...';

    container.appendChild(elementWithSpans('div', 'chain-history-item' + (h.terminal ? ' terminal' : ''), [
      ['chain-history-step', '#' + h.step],
      ['chain-history-method', h.method],
      ['chain-history-state', stateStr]
    ]));
  }

  container.scrollTop = container.scrollHeight;
}

// Collect new state values from UI (for non-terminal methods, user specifies new state)
function collectNewState() {
  var fields = chainEngine.project.stateFields;
  var newState = JSON.parse(JSON.stringify(chainEngine.currentState));

  // For now, prompt-free: auto-increment/decrement based on method name
  // In a real implementation, users could edit state fields before running
  // For the MVP, the new state is provided via a simple input
  var newStateInput = document.getElementById('chain-new-state-input');
  if (newStateInput && newStateInput.value.trim()) {
    // Throws on bad JSON. Carrying on with the current state reported a
    // successful transition the user never asked for.
    var parsed;
    try {
      parsed = JSON.parse(newStateInput.value.trim());
    } catch (e) {
      throw new Error('New State is not valid JSON: ' + e.message);
    }
    for (var key in parsed) {
      if (newState.hasOwnProperty(key)) {
        newState[key] = parsed[key];
      }
    }
  }

  return newState;
}

// Method parameter values as stack items, bottom to top. Same two forms the
// initial stack box accepts. Throws naming the parameter otherwise.
function chainParamStack(method, paramValues) {
  var items = [];
  var params = method.params || [];
  for (var j = 0; j < params.length; j++) {
    var val = paramValues[params[j].name] || '';
    if (!val) {
      items.push('0x00');
      continue;
    }
    var parsed = parseStackItem(val);
    if (parsed.error) {
      throw new Error('Parameter "' + params[j].name + '" must be a decimal number or 0x-prefixed hex, got: ' + val);
    }
    items.push(parsed.value);
  }
  return items;
}

// Build the stack the contract expects for the next transition:
// [method_params..., preimage, k1_sig]. Returns null (after logging) if it
// cannot be built. Used by Run Transition and by the Run/Step buttons.
async function prepareChainRun() {
  if (!chainEngine.project) {
    logToConsole('No chain project loaded', 'warning');
    return null;
  }

  if (!chainEngine.currentUtxo) {
    logToConsole('Chain has terminated. Reset to continue.', 'warning');
    return null;
  }

  var methodName = document.getElementById('chain-method-select').value;
  var method = chainEngine.getMethod(methodName);
  if (!method) {
    logToConsole('Unknown method: ' + methodName, 'error');
    return null;
  }

  try {
    // The UTXO was built from the contract as it was loaded. Running edited
    // text against it proves nothing about either version.
    if (chainEngine.compileContract(editor.getValue()) !== chainEngine.contractHex) {
      logToConsole('The contract in the editor no longer matches the loaded chain project. ' +
        'Save it and open the project again to run the chain against the new contract.', 'error');
      return null;
    }

    // Collect method params from UI
    var paramValues = {};
    var paramInputs = document.querySelectorAll('#chain-method-params .chain-param-input');
    for (var i = 0; i < paramInputs.length; i++) {
      paramValues[paramInputs[i].dataset.param] = paramInputs[i].value.trim();
    }

    // Collect new state
    var newState = collectNewState();
    var isTerminal = method.terminal === true;

    // Prepare transition
    var prep = chainEngine.prepareTransition(methodName, paramValues, newState);

    // Build spending transaction via IPC
    logToConsole('Building transaction...', 'info');
    var txResult = await window.electronAPI.buildChainTx({
      prevTxid: prep.prevUtxo.txid,
      prevVout: prep.prevUtxo.vout,
      prevSatoshis: prep.prevUtxo.satoshis,
      prevLockingScript: prep.prevUtxo.lockingScript,
      newLockingScript: prep.newLockingScript,
      newSatoshis: prep.newSatoshis,
      version: settings.txVersion
    });

    if (!txResult.success) {
      logToConsole('Failed to build transaction: ' + txResult.error, 'error');
      return null;
    }

    logToConsole('Transaction built: ' + txResult.txid.substring(0, 16) + '...', 'info');

    // Compute preimage and k=1 signature
    logToConsole('Computing preimage...', 'info');
    var preimageResult = await window.runar.computePreimage({
      txHex: txResult.txHex,
      inputIndex: 0,
      lockingScriptHex: prep.prevUtxo.lockingScript,
      satoshis: prep.prevUtxo.satoshis,
      codeSeparatorIndex: prep.codeSeparatorIndex
    });

    if (!preimageResult.success) {
      logToConsole('Failed to compute preimage: ' + preimageResult.error, 'error');
      return null;
    }

    // Build initial stack (bottom to top): [method_params..., preimage]
    var initialStack = chainParamStack(method, paramValues);

    // Add the preimage. checkPreimage compiles to the OP_PUSH_TX binding,
    // which derives its own signature from the preimage and leaves the
    // preimage in place. The spender supplies nothing but the preimage.
    initialStack.push('0x' + preimageResult.preimageHex);

    // Give the interpreter the transaction it is spending, so checkPreimage
    // checks the preimage against the real sighash rather than waving it
    // through. The context Settings configured is kept and the caller puts
    // it back with restoreChainContext() when the run is over.
    if (!chainBorrowedContext) {
      chainBorrowedContext = { context: interpreter.txContext, mode: interpreter.txContextMode };
    }
    interpreter.setTransactionContext({
      txHex: txResult.txHex,
      inputIndex: 0,
      prevScriptHex: prep.prevUtxo.lockingScript,
      satoshis: prep.prevUtxo.satoshis
    });

    return {
      methodName: methodName,
      newState: newState,
      isTerminal: isTerminal,
      initialStack: initialStack,
      txid: txResult.txid
    };

  } catch (err) {
    logToConsole('Chain transition error: ' + err.message, 'error');
    return null;
  }
}

async function runChainTransition() {
  await runExclusive(runChainTransitionNow);
}

async function runChainTransitionNow() {
  logToConsole('--- Chain Transition: Step ' + (chainEngine.stepCount + 1) + ' ---', 'info');

  var run = await prepareChainRun();
  if (!run) return;

  logToConsole('Executing contract...', 'info');
  // The transition replaces any step run in progress
  executionMode = 'idle';
  var result;
  try {
    result = await interpreter.run(editor.getValue(), run.initialStack, currentFilePath);
  } finally {
    restoreChainContext();
  }

  if (result.success) {
    logToConsole('Transition succeeded!', 'success');
    logToConsole('Final stack: [' + interpreter.mainStack.join(', ') + ']', 'info');
    logToConsole('Simulated: this transaction pays no fee and its txid ' +
      run.txid.substring(0, 16) + '... is provisional until it is signed and broadcast',
      'warning');

    chainEngine.advanceChain(run.methodName, run.newState, run.txid);
    clearNewStateInput();

    if (run.isTerminal) {
      logToConsole('Chain terminated (terminal method), so this transaction ' +
        'carries no output at all', 'warning');
    } else {
      logToConsole('State after transition: ' + JSON.stringify(chainEngine.currentState), 'info');
    }

    renderChainPanel();
    updateUI();
  } else {
    logToConsole('Transition FAILED: ' + result.error, 'error');
    updateUI();
  }
}

function resetChainState() {
  if (!chainEngine.project) return;
  chainEngine.resetChain();
  clearNewStateInput();
  renderChainPanel();
  interpreter.reset();
  updateUI();
  logToConsole('Chain reset to initial state', 'info');
}
