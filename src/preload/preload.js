const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Script execution
  executeScript: (script, mode) => ipcRenderer.invoke('execute-script', { script, mode }),

  // File operations
  loadFile: () => ipcRenderer.invoke('load-file'),
  saveFile: (params) => ipcRenderer.invoke('save-file', params),

  // Import system
  resolveImportPath: (currentFilePath, importPath) =>
    ipcRenderer.invoke('resolve-import-path', currentFilePath, importPath),
  readImportFile: (filePath) =>
    ipcRenderer.invoke('read-import-file', filePath),

  // Menu action listeners
  onMenuAction: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },

  // Platform info
  platform: process.platform
});

// Expose BSV SDK hash functions via IPC to main process
// Hash functions run in main process where Node modules are available
contextBridge.exposeInMainWorld('bsv', {
  sha256: (data) => ipcRenderer.invoke('bsv-sha256', data),
  sha1: (data) => ipcRenderer.invoke('bsv-sha1', data),
  ripemd160: (data) => ipcRenderer.invoke('bsv-ripemd160', data),
  hash256: (data) => ipcRenderer.invoke('bsv-hash256', data),
  hash160: (data) => ipcRenderer.invoke('bsv-hash160', data),

  // Signature verification functions
  verifyDataSig: (signatureHex, messageHex, pubKeyHex) =>
    ipcRenderer.invoke('bsv-verify-data-sig', { signatureHex, messageHex, pubKeyHex }),
  verifySig: (signatureHex, sighashHex, pubKeyHex) =>
    ipcRenderer.invoke('bsv-verify-sig', { signatureHex, sighashHex, pubKeyHex }),
  computeSighash: (txHex, inputIndex, prevScriptHex, satoshis, sighashType) =>
    ipcRenderer.invoke('bsv-compute-sighash', { txHex, inputIndex, prevScriptHex, satoshis, sighashType }),
  verifyMultiSig: (signaturesHex, pubKeysHex, sighashHex) =>
    ipcRenderer.invoke('bsv-verify-multisig', { signaturesHex, pubKeysHex, sighashHex })
});

// AI Assistant
contextBridge.exposeInMainWorld('ai', {
  chat: (params) => ipcRenderer.invoke('ai-chat', params)
});

// Expose Rúnar integration functions
contextBridge.exposeInMainWorld('runar', {
  // ScriptVM verification
  verifyScript: (scriptHex, initialStackHex) =>
    ipcRenderer.invoke('runar-verify-script', { scriptHex, initialStackHex }),

  // Deployment
  getAddress: (wif) =>
    ipcRenderer.invoke('runar-get-address', { wif }),
  getBalance: (address, network) =>
    ipcRenderer.invoke('runar-get-balance', { address, network }),
  deployScript: (params) =>
    ipcRenderer.invoke('runar-deploy-script', params),
  computePreimage: (params) =>
    ipcRenderer.invoke('runar-compute-preimage', params)
});
