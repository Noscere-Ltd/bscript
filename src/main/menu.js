/**
 * Native Menu System for SVSCRIPT
 * Provides platform-appropriate menus for macOS, Windows, and Linux
 */

const { Menu } = require('electron');

function createMenu(mainWindow) {
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
          click: () => mainWindow.webContents.send('menu-new-file')
        },
        {
          label: 'Open Script...',
          accelerator: 'CommandOrControl+O',
          click: () => mainWindow.webContents.send('menu-open-file')
        },
        {
          label: 'Open Chain Project...',
          click: () => mainWindow.webContents.send('menu-open-chain')
        },
        {
          label: 'Open Recent',
          role: 'recentdocuments',
          submenu: [
            {
              label: 'Clear Recent',
              role: 'clearrecentdocuments'
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CommandOrControl+S',
          click: () => mainWindow.webContents.send('menu-save-file')
        },
        {
          label: 'Save As...',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => mainWindow.webContents.send('menu-save-file-as')
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
          click: () => mainWindow.webContents.send('menu-run-script')
        },
        {
          label: 'Step Through',
          accelerator: 'F10',
          click: () => mainWindow.webContents.send('menu-step-script')
        },
        {
          label: 'Reset Execution',
          accelerator: 'CommandOrControl+R',
          click: () => mainWindow.webContents.send('menu-reset-script')
        },
        { type: 'separator' },
        {
          label: 'Clear Initial Stack',
          click: () => mainWindow.webContents.send('menu-clear-stack')
        },
        {
          label: 'Clear Console',
          click: () => mainWindow.webContents.send('menu-clear-console')
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
          click: () => mainWindow.webContents.send('menu-verify-script')
        },
        { type: 'separator' },
        {
          label: 'Deploy Script...',
          click: () => mainWindow.webContents.send('menu-deploy-script')
        }
      ]
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SVSCRIPT',
          click: () => mainWindow.webContents.send('menu-about')
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CommandOrControl+/',
          click: () => mainWindow.webContents.send('menu-shortcuts')
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { createMenu };
