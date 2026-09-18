function ChainEngine() {
  this.project = null;
  this.contractHex = null;        // compiled contract code (hex)
  this.methodHexMap = {};         // method name -> compiled unlock script hex
  this.currentState = null;       // current state values { fieldName: value }
  this.currentUtxo = null;        // { txid, vout, satoshis, lockingScript }
  this.history = [];              // array of { step, method, prevState, newState, txid }
  this.stepCount = 0;
}

ChainEngine.prototype.loadProject = function(projectJson, bscriptFiles) {
  // projectJson is the parsed .bsm.json
  // bscriptFiles is { relativePath: fileContent } map
  this.project = projectJson;

  // Compile the contract locking script
  var contractSource = bscriptFiles[projectJson.contract];
  if (!contractSource) throw new Error('Contract file not found: ' + projectJson.contract);

  // Parse and compile (use a temporary interpreter for macro expansion)
  var tempInterp = new ScriptInterpreter();
  var expanded = tempInterp.expandMacros(contractSource);
  // Strip comments and tokenize
  var tokens = [];
  var lines = expanded.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    var lineTokens = line.split(/\s+/).filter(function(t) { return t; });
    tokens.push.apply(tokens, lineTokens);
  }
  this.contractHex = compileInstructionsToHex(tokens);

  // Compile each method's unlock script
  this.methodHexMap = {};
  for (var m = 0; m < projectJson.methods.length; m++) {
    var method = projectJson.methods[m];
    var src = bscriptFiles[method.unlock];
    if (!src) {
      // Empty unlock script is valid (params-only methods)
      this.methodHexMap[method.name] = '';
      continue;
    }
    var mExpanded = tempInterp.expandMacros(src);
    var mTokens = [];
    var mLines = mExpanded.split('\n');
    for (var j = 0; j < mLines.length; j++) {
      var mLine = mLines[j].replace(/\/\/.*$/, '').trim();
      if (!mLine) continue;
      var mLineTokens = mLine.split(/\s+/).filter(function(t) { return t; });
      mTokens.push.apply(mTokens, mLineTokens);
    }
    this.methodHexMap[method.name] = mTokens.length > 0 ? compileInstructionsToHex(mTokens) : '';
  }

  // Set initial state
  this.currentState = {};
  for (var key in projectJson.initialState) {
    this.currentState[key] = projectJson.initialState[key];
  }

  // Create synthetic genesis UTXO
  var initialLocking = this.buildLockingScript(this.currentState);
  this.currentUtxo = {
    txid: '0000000000000000000000000000000000000000000000000000000000000000',
    vout: 0,
    satoshis: projectJson.satoshis || 10000,
    lockingScript: initialLocking
  };

  this.history = [];
  this.stepCount = 0;
};

// Serialize state fields into hex bytes
ChainEngine.prototype.serializeState = function(stateValues) {
  var fields = this.project.stateFields;
  var hexParts = [];

  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    var value = stateValues[field.name];
    var fieldHex;

    if (field.type === 'int') {
      // Encode as script number
      var encoded = encodeScriptNumber(BigInt(value || 0));
      if (encoded.length === 0) {
        // Zero encodes as empty, but we need to push it as OP_0
        hexParts.push('00');
        continue;
      }
      var pushBytes = emitPushData(encoded);
      fieldHex = bytesToHex(new Uint8Array(pushBytes));
    } else {
      // bytes, pubkey, sig, hash — raw hex with push data prefix
      var rawHex = String(value || '');
      if (rawHex.length === 0) {
        hexParts.push('00'); // OP_0 for empty
        continue;
      }
      var dataBytes = hexToBytes(rawHex);
      var pushBytes2 = emitPushData(dataBytes);
      fieldHex = bytesToHex(new Uint8Array(pushBytes2));
    }

    hexParts.push(fieldHex);
  }

  return hexParts.join('');
};

// Build full locking script: <contract_code> OP_RETURN <state_data>
ChainEngine.prototype.buildLockingScript = function(stateValues) {
  var stateHex = this.serializeState(stateValues);
  return this.contractHex + '6a' + stateHex;
};

// Get the code portion of a locking script: everything before the OP_RETURN
// that separates the code from the state. buildLockingScript appends that
// OP_RETURN last, so it is the last one, and a contract is free to use an
// earlier OP_RETURN of its own.
ChainEngine.prototype.getCodePortion = function(lockingScriptHex) {
  var bytes = hexToBytes(lockingScriptHex);
  var lastReturn;

  forEachOpcode(bytes, function(op, index) {
    if (op === 0x6a) lastReturn = index;
  });

  if (lastReturn === undefined) return lockingScriptHex;
  return bytesToHex(bytes.slice(0, lastReturn));
};

// Find the last OP_CODESEPARATOR offset in the locking script
ChainEngine.prototype.findCodeSeparator = function(lockingScriptHex) {
  var lastSep;

  forEachOpcode(hexToBytes(lockingScriptHex), function(op, index) {
    if (op === 0xab) lastSep = index;
  });

  return lastSep;
};

// Get method definition by name
ChainEngine.prototype.getMethod = function(methodName) {
  for (var i = 0; i < this.project.methods.length; i++) {
    if (this.project.methods[i].name === methodName) {
      return this.project.methods[i];
    }
  }
  return null;
};

// Prepare a transition: returns everything needed to execute
// newState is required for non-terminal methods (the caller decides the new state)
ChainEngine.prototype.prepareTransition = function(methodName, paramValues, newState) {
  var method = this.getMethod(methodName);
  if (!method) throw new Error('Unknown method: ' + methodName);

  var isTerminal = method.terminal === true;
  var newLockingScript = isTerminal ? null : this.buildLockingScript(newState || this.currentState);
  var newSatoshis = isTerminal ? 0 : this.currentUtxo.satoshis;

  return {
    method: method,
    isTerminal: isTerminal,
    prevUtxo: {
      txid: this.currentUtxo.txid,
      vout: this.currentUtxo.vout,
      satoshis: this.currentUtxo.satoshis,
      lockingScript: this.currentUtxo.lockingScript
    },
    newLockingScript: newLockingScript,
    newSatoshis: newSatoshis,
    paramValues: paramValues,
    codeSeparatorIndex: this.findCodeSeparator(this.currentUtxo.lockingScript)
  };
};

// Advance chain after successful transition
ChainEngine.prototype.advanceChain = function(methodName, newState, txid) {
  var method = this.getMethod(methodName);
  var isTerminal = method.terminal === true;

  this.stepCount++;
  this.history.push({
    step: this.stepCount,
    method: methodName,
    prevState: JSON.parse(JSON.stringify(this.currentState)),
    newState: isTerminal ? null : JSON.parse(JSON.stringify(newState)),
    txid: txid,
    terminal: isTerminal
  });

  if (!isTerminal) {
    this.currentState = JSON.parse(JSON.stringify(newState));
    var newLocking = this.buildLockingScript(this.currentState);
    this.currentUtxo = {
      txid: txid,
      vout: 0,
      satoshis: this.currentUtxo.satoshis,
      lockingScript: newLocking
    };
  } else {
    this.currentUtxo = null;
  }
};

// Reset chain to initial state
ChainEngine.prototype.resetChain = function() {
  this.currentState = {};
  for (var key in this.project.initialState) {
    this.currentState[key] = this.project.initialState[key];
  }

  var initialLocking = this.buildLockingScript(this.currentState);
  this.currentUtxo = {
    txid: '0000000000000000000000000000000000000000000000000000000000000000',
    vout: 0,
    satoshis: this.project.satoshis || 10000,
    lockingScript: initialLocking
  };

  this.history = [];
  this.stepCount = 0;
};
