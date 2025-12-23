const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
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
  return Hash.sha256(buffer).toString('hex');
});

ipcMain.handle('bsv-sha1', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Hash.sha1(buffer).toString('hex');
});

ipcMain.handle('bsv-ripemd160', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Hash.ripemd160(buffer).toString('hex');
});

ipcMain.handle('bsv-hash256', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Hash.hash256(buffer).toString('hex');
});

ipcMain.handle('bsv-hash160', async (event, data) => {
  const { Hash } = getBsvSdk();
  const buffer = Buffer.from(data, 'utf8');
  return Hash.hash160(buffer).toString('hex');
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
