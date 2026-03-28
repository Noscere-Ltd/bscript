const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const { createMenu } = require('./menu');

// Lazy load BSV SDK modules when needed (loaded on first use)
// This avoids potential conflicts with Electron's module loading
let _bsvSdk = null;
function getBsvSdk() {
  if (!_bsvSdk) {
    _bsvSdk = require('@bsv/sdk');
  }
  return _bsvSdk;
}

let mainWindow;
let lastUsedDirectory = null; // Track last directory for file dialogs

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      // Security: Context isolation enabled
      contextIsolation: true,
      // Security: Node integration disabled in renderer
      nodeIntegration: false,
      // Security: Sandbox enabled
      sandbox: true,
      // Preload script for secure IPC bridge
      preload: path.join(__dirname, '../preload/preload.js')
    },
    backgroundColor: '#1e1e1e',
    show: false
  });

  // Load the index.html
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Set up native menu
  const menu = createMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create window when app is ready
app.whenReady().then(createWindow);

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Re-create window when dock icon clicked (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers for Script Execution
// These handlers run in the main process (Node.js environment)
// and communicate securely with the renderer process

ipcMain.handle('execute-script', async (event, { script, mode }) => {
  try {
    // The interpreter will be executed in the renderer process
    // This handler is just a placeholder for future main-process operations
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-file', async (event) => {
  try {
    // Default to examples directory if no previous directory used
    const defaultPath = lastUsedDirectory || path.join(__dirname, '../../examples');

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Bitcoin Script', extensions: ['bscript'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: defaultPath
    });

    if (result.canceled) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');

    // Remember this directory for next time
    lastUsedDirectory = path.dirname(filePath);

    // Add to recent documents
    app.addRecentDocument(filePath);

    return {
      success: true,
      content: content,
      filePath: filePath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('save-file', async (event, { content, filePath }) => {
  try {
    let savePath = filePath;

    // If no path provided, show save dialog
    if (!savePath) {
      // Default to examples directory if no previous directory used
      const defaultDir = lastUsedDirectory || path.join(__dirname, '../../examples');
      const defaultFilePath = path.join(defaultDir, 'untitled.bscript');

      const result = await dialog.showSaveDialog(mainWindow, {
        filters: [
          { name: 'Bitcoin Script', extensions: ['bscript'] }
        ],
        defaultPath: defaultFilePath
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      savePath = result.filePath;
    }

    await fs.writeFile(savePath, content, 'utf-8');

    // Remember this directory for next time
    lastUsedDirectory = path.dirname(savePath);

    // Add to recent documents
    app.addRecentDocument(savePath);

    return {
      success: true,
      filePath: savePath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// IPC Handlers for import system
ipcMain.handle('resolve-import-path', async (event, currentFilePath, importPath) => {
  try {
    // If currentFilePath is null (unsaved file), resolve relative to examples directory
    const baseDir = currentFilePath
      ? path.dirname(currentFilePath)
      : path.join(__dirname, '../renderer');

    const resolvedPath = path.resolve(baseDir, importPath);

    return {
      success: true,
      resolvedPath: resolvedPath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('read-import-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');

    return {
      success: true,
      content: content,
      filePath: filePath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// IPC Handlers for BSV SDK hash functions
// These run in the main process where Node modules are available

ipcMain.handle('bsv-sha256', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Buffer.from(Hash.sha256(buffer)).toString('hex');
});

ipcMain.handle('bsv-sha1', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Buffer.from(Hash.sha1(buffer)).toString('hex');
});

ipcMain.handle('bsv-ripemd160', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Buffer.from(Hash.ripemd160(buffer)).toString('hex');
});

ipcMain.handle('bsv-hash256', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Buffer.from(Hash.hash256(buffer)).toString('hex');
});

ipcMain.handle('bsv-hash160', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Buffer.from(Hash.hash160(buffer)).toString('hex');
});

// IPC Handlers for BSV SDK signature verification
// These run in the main process where Node modules are available

// Verify data signature (for checkDataSig opcode)
// Message is expected to be already hashed (SHA256) per Bitcoin Script convention
ipcMain.handle('bsv-verify-data-sig', async (event, { signatureHex, messageHex, pubKeyHex }) => {
  try {
    const { PublicKey, Signature } = getBsvSdk();

    // Parse the public key (supports compressed 33-byte and uncompressed 65-byte)
    const pubKey = PublicKey.fromString(pubKeyHex);

    // Parse the DER-encoded signature
    const signature = Signature.fromDER(signatureHex, 'hex');

    // Convert message hash to array for verification
    const messageBytes = Array.from(Buffer.from(messageHex, 'hex'));

    // Verify signature over the message hash
    const isValid = signature.verify(messageBytes, pubKey);

    return { success: true, valid: isValid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Verify signature with pre-computed sighash (for checkSig opcode)
ipcMain.handle('bsv-verify-sig', async (event, { signatureHex, sighashHex, pubKeyHex }) => {
  try {
    const { PublicKey, Signature } = getBsvSdk();

    const pubKey = PublicKey.fromString(pubKeyHex);

    // Parse signature - may include trailing sighash type byte
    const sigBytes = Buffer.from(signatureHex, 'hex');
    let signature;

    if (sigBytes.length > 0) {
      // Check if last byte is sighash type (0x01-0x83 range)
      const lastByte = sigBytes[sigBytes.length - 1];
      if (lastByte >= 0x01 && lastByte <= 0x83) {
        // Strip sighash byte for verification
        const derBytes = sigBytes.slice(0, -1);
        signature = Signature.fromDER(Array.from(derBytes));
      } else {
        signature = Signature.fromDER(signatureHex, 'hex');
      }
    } else {
      signature = Signature.fromDER(signatureHex, 'hex');
    }

    // Convert sighash to array for verification
    const sighashBytes = Array.from(Buffer.from(sighashHex, 'hex'));

    // Verify signature
    const isValid = signature.verify(sighashBytes, pubKey);

    return { success: true, valid: isValid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Compute sighash from full transaction context
ipcMain.handle('bsv-compute-sighash', async (event, { txHex, inputIndex, prevScriptHex, satoshis, sighashType }) => {
  try {
    const { Transaction, Script, TransactionSignature, Hash } = getBsvSdk();

    // Parse the spending transaction
    const tx = Transaction.fromHex(txHex);

    // Parse the previous output script
    const subscript = Script.fromHex(prevScriptHex);

    // Default sighash type for BSV: SIGHASH_ALL | SIGHASH_FORKID
    const scope = sighashType || (TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID);

    // Get transaction details for sighash computation
    const input = tx.inputs[inputIndex];
    const otherInputs = tx.inputs.filter((_, i) => i !== inputIndex);

    // Compute the sighash preimage
    const preimage = TransactionSignature.format({
      sourceTXID: input.sourceTXID,
      sourceOutputIndex: input.sourceOutputIndex,
      sourceSatoshis: satoshis,
      transactionVersion: tx.version,
      otherInputs: otherInputs,
      outputs: tx.outputs,
      inputIndex: inputIndex,
      subscript: subscript,
      inputSequence: input.sequence,
      lockTime: tx.lockTime,
      scope: scope
    });

    // Double SHA256 the preimage to get sighash
    const sighash = Hash.hash256(Buffer.from(preimage));

    return { success: true, sighash: Buffer.from(sighash).toString('hex') };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Verify multisig (for checkMultiSig opcode)
ipcMain.handle('bsv-verify-multisig', async (event, { signaturesHex, pubKeysHex, sighashHex }) => {
  try {
    const { PublicKey, Signature } = getBsvSdk();

    // Parse all public keys
    const pubKeys = pubKeysHex.map(hex => PublicKey.fromString(hex));

    // Parse all signatures (filter empty ones, strip sighash bytes)
    const signatures = signaturesHex
      .filter(sig => sig && sig.length > 0)
      .map(hex => {
        const sigBytes = Buffer.from(hex, 'hex');
        // Strip sighash byte if present
        if (sigBytes.length > 0) {
          const lastByte = sigBytes[sigBytes.length - 1];
          if (lastByte >= 0x01 && lastByte <= 0x83) {
            return Signature.fromDER(Array.from(sigBytes.slice(0, -1)));
          }
        }
        return Signature.fromDER(hex, 'hex');
      });

    const sighashBytes = Array.from(Buffer.from(sighashHex, 'hex'));

    // Bitcoin multisig: signatures must match pubkeys in order
    // Each signature consumes the next matching pubkey
    let pubKeyIndex = 0;
    let validCount = 0;

    for (const sig of signatures) {
      while (pubKeyIndex < pubKeys.length) {
        try {
          const isValid = sig.verify(sighashBytes, pubKeys[pubKeyIndex]);
          pubKeyIndex++;
          if (isValid) {
            validCount++;
            break;
          }
        } catch (e) {
          // Invalid signature format or verification error, try next pubkey
          pubKeyIndex++;
        }
      }
    }

    const allValid = validCount === signatures.length;
    return { success: true, valid: allValid, validCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// Rúnar Integration - ESM dynamic import loaders
// ---------------------------------------------------------------------------

let _runarTesting = null;
async function getRunarTesting() {
  if (!_runarTesting) {
    _runarTesting = await import('runar-testing');
  }
  return _runarTesting;
}

let _runarSdk = null;
async function getRunarSdk() {
  if (!_runarSdk) {
    _runarSdk = await import('runar-sdk');
  }
  return _runarSdk;
}

// ---------------------------------------------------------------------------
// Rúnar ScriptVM Verification
// ---------------------------------------------------------------------------

ipcMain.handle('runar-verify-script', async (event, { scriptHex, initialStackHex }) => {
  try {
    const { ScriptVM, hexToBytes, bytesToHex } = await getRunarTesting();

    // Build unlocking script from initial stack values (push each as data)
    let unlockingHex = '';
    if (initialStackHex && initialStackHex.length > 0) {
      for (const itemHex of initialStackHex) {
        if (!itemHex || itemHex.length === 0) {
          unlockingHex += '00'; // OP_0
        } else {
          const byteLen = itemHex.length / 2;
          if (byteLen <= 75) {
            unlockingHex += byteLen.toString(16).padStart(2, '0') + itemHex;
          } else if (byteLen <= 255) {
            unlockingHex += '4c' + byteLen.toString(16).padStart(2, '0') + itemHex;
          } else {
            unlockingHex += '4d' + (byteLen & 0xff).toString(16).padStart(2, '0') + ((byteLen >> 8) & 0xff).toString(16).padStart(2, '0') + itemHex;
          }
        }
      }
    }

    const vm = new ScriptVM();
    let result;

    if (unlockingHex) {
      const unlockingScript = hexToBytes(unlockingHex);
      const lockingScript = hexToBytes(scriptHex);
      result = vm.execute(unlockingScript, lockingScript);
    } else {
      result = vm.executeHex(scriptHex);
    }

    return {
      success: result.success,
      stack: result.stack.map(bytes => bytesToHex(bytes)),
      altStack: result.altStack.map(bytes => bytesToHex(bytes)),
      vmError: result.error || null,
      opsExecuted: result.opsExecuted,
      maxStackDepth: result.maxStackDepth
    };
  } catch (error) {
    return { success: false, stack: [], altStack: [], vmError: error.message, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// Rúnar SDK Deployment
// ---------------------------------------------------------------------------

ipcMain.handle('runar-get-address', async (event, { wif }) => {
  try {
    const { LocalSigner } = await getRunarSdk();
    const signer = new LocalSigner(wif);
    const address = await signer.getAddress();
    const pubKey = await signer.getPublicKey();
    return { success: true, address, pubKey };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('runar-get-balance', async (event, { address, network }) => {
  try {
    const { WhatsOnChainProvider } = await getRunarSdk();
    const provider = new WhatsOnChainProvider(network || 'mainnet');
    const utxos = await provider.getUtxos(address);
    const total = utxos.reduce((sum, u) => sum + u.satoshis, 0);
    return { success: true, balance: total, utxoCount: utxos.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('runar-deploy-script', async (event, { wif, scriptHex, satoshis, network }) => {
  try {
    const { LocalSigner, WhatsOnChainProvider, buildDeployTransaction, selectUtxos, buildP2PKHScript } = await getRunarSdk();
    const { Transaction, UnlockingScript } = getBsvSdk();

    const signer = new LocalSigner(wif);
    const address = await signer.getAddress();
    const provider = new WhatsOnChainProvider(network || 'mainnet');

    // Get UTXOs
    const allUtxos = await provider.getUtxos(address);
    if (allUtxos.length === 0) {
      return { success: false, error: 'No UTXOs available. Fund the address first.' };
    }

    // Select UTXOs
    const scriptByteLen = scriptHex.length / 2;
    const selected = selectUtxos(allUtxos, satoshis, scriptByteLen);

    // Build change script
    const changeScript = buildP2PKHScript(address);

    // Build unsigned transaction
    const { tx, inputCount } = buildDeployTransaction(scriptHex, selected, satoshis, address, changeScript);

    // Sign each input
    const txHex = tx.toHex();
    for (let i = 0; i < inputCount; i++) {
      const sigHex = await signer.sign(txHex, i, changeScript, selected[i].satoshis);
      const pubKeyHex = await signer.getPublicKey();

      // Build P2PKH unlocking script: <sig> <pubkey>
      const sigBytes = Buffer.from(sigHex, 'hex');
      const pubBytes = Buffer.from(pubKeyHex, 'hex');

      let unlockHex = '';
      // Push signature
      unlockHex += sigBytes.length.toString(16).padStart(2, '0') + sigHex;
      // Push pubkey
      unlockHex += pubBytes.length.toString(16).padStart(2, '0') + pubKeyHex;

      tx.inputs[i].unlockingScript = UnlockingScript.fromHex(unlockHex);
    }

    // Broadcast
    const txid = await provider.broadcast(tx);

    return { success: true, txid, address };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// AI Assistant
// ---------------------------------------------------------------------------

const BSCRIPT_SYSTEM_PROMPT = `You are an expert Bitcoin Script developer assistant for SVSCRIPT, a Bitcoin Script IDE.

You write scripts using camelCase opcodes. Here are all valid opcodes:
false, true, nop, if, notIf, else, endIf, verify, return,
toAltStack, fromAltStack, 2drop, 2dup, 3dup, 2over, 2rot, 2swap,
ifDup, depth, drop, dup, nip, over, pick, roll, rot, swap, tuck,
cat, split, num2bin, bin2num, size, invert, and, or, xor, equal, equalVerify,
1add, 1sub, negate, abs, not, 0notEqual,
add, sub, mul, div, mod, lShift, rShift,
booland, boolor, numEqual, numEqualVerify, numNotEqual,
lessThan, greaterThan, lessThanOrEqual, greaterThanOrEqual, min, max, within,
ripemd160, sha1, sha256, hash160, hash256,
checkSig, checkSigVerify, checkMultiSig, checkMultiSigVerify, checkDataSig, checkDataSigVerify

Syntax rules:
- One opcode per line (or space-separated on a line)
- Comments start with //
- Integer literals: 0, 1, -1, 42, 1000 etc.
- Hex data literals: 0x followed by even hex digits, e.g. 0xdeadbeef
- Flow control: if/else/endIf blocks (notIf for negated condition)
- Stack-based execution: values pushed left-to-right, opcodes consume from top
- The script succeeds if the top stack value is truthy (non-zero) when execution ends

Example - check if a number is greater than 10:
// Push threshold and compare
dup
10 greaterThan
verify

Example - hash and compare:
dup
sha256
0x<expected_hash> equal

When generating scripts:
- Include clear comments explaining each section
- Suggest initial stack values the user should provide
- Keep scripts concise and idiomatic

When explaining scripts:
- Walk through the stack state step by step
- Explain what each opcode does to the stack

When fixing errors:
- Identify the root cause
- Provide the corrected script`;

function makeApiRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
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
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

ipcMain.handle('ai-chat', async (event, { provider, apiKey, model, messages, editorContent }) => {
  try {
    if (!apiKey) {
      return { success: false, error: 'API key not configured. Set it in Settings > AI Assistant.' };
    }

    // Build context-aware system prompt
    let systemPrompt = BSCRIPT_SYSTEM_PROMPT;
    if (editorContent && editorContent.trim()) {
      systemPrompt += '\n\nThe user currently has this script in their editor:\n```\n' + editorContent + '\n```';
    }

    let reply;

    if (provider === 'claude') {
      const result = await makeApiRequest(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        },
        {
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages
        }
      );
      reply = result.content.map(b => b.text).join('');

    } else if (provider === 'openai') {
      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];
      const result = await makeApiRequest(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        },
        {
          model: model || 'gpt-4o',
          max_tokens: 4096,
          messages: openaiMessages
        }
      );
      reply = result.choices[0].message.content;

    } else {
      return { success: false, error: `Unknown provider: ${provider}` };
    }

    return { success: true, reply };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Compute OP_PUSH_TX preimage and signature
ipcMain.handle('runar-compute-preimage', async (event, { txHex, inputIndex, lockingScriptHex, satoshis, codeSeparatorIndex }) => {
  try {
    const { computeOpPushTx } = await getRunarSdk();
    const result = computeOpPushTx(txHex, inputIndex, lockingScriptHex, satoshis, codeSeparatorIndex);
    return { success: true, sigHex: result.sigHex, preimageHex: result.preimageHex };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
