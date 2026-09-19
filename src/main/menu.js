/**
 * Native Menu System for SVSCRIPT
 * Provides platform-appropriate menus for macOS, Windows, and Linux
 */

const { Menu, BrowserWindow } = require('electron');

// Resolve the window when the item is clicked. On macOS the menu outlives the
// window, so a window captured at build time may already be destroyed.
function send(channel) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send(channel);
}

function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: 'SVSCRIPT',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Script',
          accelerator: 'CommandOrControl+N',
          click: () => send('menu-new-file')
        },
        {
          label: 'Open Script...',
          accelerator: 'CommandOrControl+O',
          click: () => send('menu-open-file')
        },
        {
          label: 'Open Chain Project...',
          click: () => send('menu-open-chain')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click: () => send('menu-save-file')
        },
        {
          label: 'Save As...',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => send('menu-save-file-as')
        },
        { type: 'separator' },
        ...(isMac ? [] : [
          { role: 'quit' }
        ])
      ]
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },

    // Run menu
    {
      label: 'Run',
      submenu: [
        {
          label: 'Execute Script',
          accelerator: 'CommandOrControl+Enter',
          click: () => send('menu-run-script')
        },
        {
          label: 'Step Through',
          accelerator: 'F10',
          click: () => send('menu-step-script')
        },
        {
          label: 'Reset Execution',
          accelerator: 'CommandOrControl+R',
          click: () => send('menu-reset-script')
        },
        { type: 'separator' },
        {
          label: 'Clear Initial Stack',
          click: () => send('menu-clear-stack')
        },
        {
          label: 'Clear Console',
          click: () => send('menu-clear-console')
        }
      ]
    },

    // Tools menu
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Verify with ScriptVM',
          accelerator: 'CommandOrControl+Shift+V',
          click: () => send('menu-verify-script')
        },
        { type: 'separator' },
        {
          label: 'Deploy Script...',
          click: () => send('menu-deploy-script')
        }
      ]
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SVSCRIPT',
          click: () => send('menu-about')
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CommandOrControl+/',
          click: () => send('menu-shortcuts')
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { createMenu };
