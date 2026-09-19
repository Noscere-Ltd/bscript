const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs').promises;
const { createMenu } = require('./menu');
const { toHashBuffer } = require('./hash-input');
const { makeApiRequest } = require('./api-request');
const { resolveProjectFile } = require('./chain-paths');
const { deployScript, assertNetwork } = require('./deploy');

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

// Paths the user picked in a file dialog this session, plus the examples that
// ship with the app. The renderer names the file it wants to write or import,
// and a script, a chain project or an AI reply can reach those calls, so the
// main process only honours a path the user has already chosen. Without this
// the renderer can write anywhere the app can.
const grantedFiles = new Set();
const grantedDirs = new Set([path.resolve(__dirname, '../../examples')]);

function grantPath(filePath) {
  grantedFiles.add(path.resolve(filePath));
  grantedDirs.add(path.dirname(path.resolve(filePath)));
}

function isInGrantedDir(filePath) {
  const resolved = path.resolve(filePath);
  for (const dir of grantedDirs) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) return true;
  }
  return false;
}

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

  // The preload bridge attaches to whatever page this window loads, so the
  // window never leaves the app's own page.
  const indexPath = path.join(__dirname, '../renderer/index.html');
  const indexUrl = pathToFileURL(indexPath).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== indexUrl) event.preventDefault();
  });
  // A child window would inherit the preload. The one target=_blank link (the
  // deploy explorer link) opens in the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the index.html
  mainWindow.loadFile(indexPath);

  // Set up native menu
  const menu = createMenu();
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
        { name: 'Chain Project', extensions: ['json'] },
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
    grantPath(filePath);

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
      grantPath(savePath);
    } else if (!grantedFiles.has(path.resolve(savePath))) {
      return {
        success: false,
        error: 'Refusing to write to a path that was not chosen in a file dialog this session: ' + savePath
      };
    }

    await fs.writeFile(savePath, content, 'utf-8');

    // Remember this directory for next time
    lastUsedDirectory = path.dirname(savePath);

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
    if (path.extname(filePath) !== '.bscript') {
      return { success: false, error: 'Imports must be .bscript files: ' + filePath };
    }
    if (!isInGrantedDir(filePath)) {
      return {
        success: false,
        error: 'Refusing to read outside the directories opened this session: ' + filePath
      };
    }

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
  const buffer = toHashBuffer(data);
  return Buffer.from(Hash.sha256(buffer)).toString('hex');
});

ipcMain.handle('bsv-sha1', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = toHashBuffer(data);
  return Buffer.from(Hash.sha1(buffer)).toString('hex');
});

ipcMain.handle('bsv-ripemd160', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = toHashBuffer(data);
  return Buffer.from(Hash.ripemd160(buffer)).toString('hex');
});

ipcMain.handle('bsv-hash256', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = toHashBuffer(data);
  return Buffer.from(Hash.hash256(buffer)).toString('hex');
});

ipcMain.handle('bsv-hash160', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = toHashBuffer(data);
  return Buffer.from(Hash.hash160(buffer)).toString('hex');
});

// IPC Handlers for BSV SDK signature verification
// These run in the main process where Node modules are available

const { sighashFor, verifySig, verifyMultiSig } = require('./signature');
const { preimageForScript } = require('./verify-preimage');
const { runInVm } = require('./vm-verify');

ipcMain.handle('bsv-verify-sig', async (event, params) => verifySig(params));

ipcMain.handle('bsv-verify-multisig', async (event, params) => verifyMultiSig(params));

// Compute sighash from full transaction context
ipcMain.handle('bsv-compute-sighash', async (event, { txHex, inputIndex, prevScriptHex, satoshis, sighashType, subscriptHex }) => {
  try {
    const { TransactionSignature } = getBsvSdk();
    const scope = sighashType ||
      (TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID);

    return {
      success: true,
      sighash: sighashFor({ txHex, inputIndex, prevScriptHex, satoshis, subscriptHex }, scope)
    };
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
    _runarTesting = await import('../vendor/runar/vm/index.js');
  }
  return _runarTesting;
}

let _runarSdk = null;
async function getRunarSdk() {
  if (!_runarSdk) {
    _runarSdk = await import('../vendor/runar/sdk/index.js');
  }
  return _runarSdk;
}

// ---------------------------------------------------------------------------
// Rúnar ScriptVM Verification
// ---------------------------------------------------------------------------

// The preimage that satisfies the OP_PUSH_TX binding inside the ScriptVM,
// which runs scripts against a synthetic transaction of its own.
ipcMain.handle('runar-verify-preimage', async (event, { scriptHex }) => {
  try {
    return { success: true, ...(await preimageForScript(scriptHex)) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('runar-verify-script', async (event, params) => {
  try {
    // src/main/vm-verify.js runs the VM under the rules of params.txVersion
    return runInVm(await getRunarTesting(), params || {});
  } catch (error) {
    return { success: false, stack: [], altStack: [], vmError: error.message, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// Rúnar SDK Deployment
// ---------------------------------------------------------------------------

ipcMain.handle('runar-get-address', async (event, { wif, network }) => {
  try {
    assertNetwork(network);
    const { LocalSigner } = await getRunarSdk();
    const signer = new LocalSigner(wif, network);
    const address = await signer.getAddress();
    const pubKey = await signer.getPublicKey();
    return { success: true, address, pubKey };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('runar-get-balance', async (event, { address, network }) => {
  try {
    assertNetwork(network);
    const { WhatsOnChainProvider } = await getRunarSdk();
    const provider = new WhatsOnChainProvider(network);
    const utxos = await provider.getUtxos(address);
    const total = utxos.reduce((sum, u) => sum + u.satoshis, 0);
    return { success: true, balance: total, utxoCount: utxos.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('runar-deploy-script', async (event, params) => {
  try {
    // src/main/deploy.js holds the refusals and the one-at-a-time flag
    return await deployScript(params || {}, {
      runar: await getRunarSdk(),
      UnlockingScript: getBsvSdk().UnlockingScript
    });
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
ver, verIf, verNotIf,
cat, split, substr, left, right, num2bin, bin2num, size,
invert, and, or, xor, equal, equalVerify,
1add, 1sub, 2mul, 2div, negate, abs, not, 0notEqual,
add, sub, mul, div, mod, lShift, rShift, lShiftNum, rShiftNum,
booland, boolor, numEqual, numEqualVerify, numNotEqual,
lessThan, greaterThan, lessThanOrEqual, greaterThanOrEqual, min, max, within,
ripemd160, sha1, sha256, hash160, hash256,
checkSig, checkSigVerify, checkMultiSig, checkMultiSigVerify

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
          model: model || 'claude-sonnet-5',
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

// ---------------------------------------------------------------------------
// Chain Mode - Project loading and transaction building
// ---------------------------------------------------------------------------

ipcMain.handle('open-chain-dialog', async (event) => {
  try {
    const defaultPath = lastUsedDirectory || path.join(__dirname, '../../examples');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Chain Project', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: defaultPath
    });
    if (result.canceled) {
      return { success: false, canceled: true };
    }
    const filePath = result.filePaths[0];
    lastUsedDirectory = path.dirname(filePath);
    grantPath(filePath);
    return { success: true, filePath: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-chain-project', async (event, filePath) => {
  try {
    // The renderer names the project, so only honour one the user picked in
    // open-chain-dialog, the same rule save-file applies
    if (typeof filePath !== 'string' || !grantedFiles.has(path.resolve(filePath))) {
      return {
        success: false,
        error: 'Refusing to load a chain project that was not chosen in a file dialog this session: ' + filePath
      };
    }

    const projectDir = path.dirname(path.resolve(filePath));
    const projectContent = await fs.readFile(filePath, 'utf-8');
    const project = JSON.parse(projectContent);

    // The contract is the only file read. Method unlock scripts are not
    // executed (the chain engine supplies params and preimage itself), so the
    // `unlock` field is ignored.
    // The second check follows symlinks, which a downloaded project can carry.
    const contractPath = resolveProjectFile(projectDir, project.contract);
    resolveProjectFile(await fs.realpath(projectDir), await fs.realpath(contractPath));

    const bscriptFiles = {};
    bscriptFiles[project.contract] = await fs.readFile(contractPath, 'utf-8');

    // Save writes the contract, so it is granted the way an opened file is
    grantPath(contractPath);

    return {
      success: true,
      project: project,
      bscriptFiles: bscriptFiles,
      projectPath: filePath,
      contractPath: contractPath
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('build-chain-tx', async (event, { prevTxid, prevVout, prevSatoshis, prevLockingScript, newLockingScript, newSatoshis, version }) => {
  try {
    const { Transaction, LockingScript, UnlockingScript } = getBsvSdk();

    // The version decides which rule set the spend is judged under
    const tx = new Transaction(version || 1);

    // Add input (spending the previous UTXO)
    tx.addInput({
      sourceTXID: prevTxid,
      sourceOutputIndex: prevVout,
      unlockingScript: new UnlockingScript(),
      sequence: 0xffffffff
    });

    // Add continuation output (non-terminal) or nothing (terminal)
    if (newLockingScript) {
      tx.addOutput({
        satoshis: newSatoshis,
        lockingScript: LockingScript.fromHex(newLockingScript)
      });
    }

    const txHex = tx.toHex();
    // Compute a txid for chain tracking (hash256 of tx hex)
    const { Hash } = getBsvSdk();
    const txBytes = Buffer.from(txHex, 'hex');
    const txidBytes = Buffer.from(Hash.hash256(txBytes));
    // Reverse for display (Bitcoin txids are displayed reversed)
    const txid = Array.from(txidBytes).reverse().map(b => b.toString(16).padStart(2, '0')).join('');

    return { success: true, txHex: txHex, txid: txid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
