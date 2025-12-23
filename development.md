# SVSCRIPT Development Guide

Guide for developers who want to extend or modify SVSCRIPT.

## Project Structure

```
svscript/
├── src/
│   ├── main/
│   │   └── main.js              # Electron main process (Node.js)
│   ├── preload/
│   │   └── preload.js           # IPC bridge (contextBridge API)
│   └── renderer/
│       ├── index.html           # Application UI structure
│       ├── styles.css           # UI styling (dark theme)
│       ├── app.js               # Main application controller
│       ├── interpreter.js       # Bitcoin Script interpreter engine
│       └── syntax.js            # Monaco Editor language definition
├── examples/                     # Example Bitcoin Scripts
├── package.json                  # Dependencies and scripts
├── README.md                     # User documentation
├── QUICKSTART.md                # Quick start guide
├── claude.md                    # Opcode reference
└── DEVELOPMENT.md               # This file
```

## Architecture

### Main Process (src/main/main.js)

The main process is the entry point for Electron:
- Creates and manages BrowserWindow
- Handles application lifecycle
- Implements secure configuration:
  - Context isolation enabled
  - Node integration disabled
  - Sandbox enabled
- Future: File I/O, native dialogs, menu bar

### Preload Script (src/preload/preload.js)

Secure bridge between main and renderer processes:
- Uses `contextBridge` to expose limited API
- No direct Node.js access in renderer
- Currently exposes:
  - `executeScript` (placeholder)
  - `loadFile` (placeholder)
  - `saveFile` (placeholder)
  - `platform` (OS detection)

### Renderer Process (src/renderer/)

Runs in sandboxed browser environment:

#### index.html
- Application UI layout
- Three-panel design (editor, debugger, console)
- Monaco Editor CDN integration
- Loads all JavaScript modules

#### styles.css
- Dark theme based on VS Code
- CSS variables for easy theming
- Responsive layout
- Custom scrollbars

#### app.js
- Application controller and UI logic
- Monaco Editor initialization
- Event handlers (run, step, reset)
- UI updates (stack, history, state)
- Console logging
- Keyboard shortcuts

#### interpreter.js
- Core Bitcoin Script interpreter
- Stack-based execution engine
- Opcode implementations
- Error handling
- Execution history tracking

#### syntax.js
- Monaco Editor language definition
- Monarch tokenizer for Bitcoin Script
- Syntax highlighting rules
- Theme definition
- Auto-completion configuration

## Adding New Opcodes

### 1. Implement the Opcode

In `src/renderer/interpreter.js`:

```javascript
// Add to opcodeMap in executeOpcode()
'myNewOpcode': () => this.op_mynewopcode(),

// Implement the opcode method
op_mynewopcode() {
  const b = this.popStack();
  const a = this.popStack();
  const result = /* your logic here */;
  this.pushStack(result);
  this.addHistory('myNewOpcode', `Description of operation`);
}
```

### 2. Add Syntax Highlighting

In `src/renderer/syntax.js`, add to keywords array:

```javascript
keywords: [
  // ... existing keywords
  'myNewOpcode',
],
```

### 3. Update Documentation

Add to `claude.md` opcode reference table.

### Example: Adding OP_MIN3

```javascript
// In interpreter.js executeOpcode()
'min3': () => this.op_min3(),

// Implementation
op_min3() {
  const c = this.toNumber(this.popStack());
  const b = this.toNumber(this.popStack());
  const a = this.toNumber(this.popStack());
  this.pushStack(Math.min(a, b, c));
  this.addHistory('min3', `min(${a}, ${b}, ${c}) = ${Math.min(a, b, c)}`);
}

// In syntax.js
keywords: [
  // ...
  'min3',
],
```

## Customizing the UI

### Changing Colors

Edit CSS variables in `src/renderer/styles.css`:

```css
:root {
  --bg-primary: #1e1e1e;        /* Main background */
  --bg-secondary: #252526;      /* Panel backgrounds */
  --accent-blue: #007acc;       /* Primary accent */
  /* ... modify other colors */
}
```

### Modifying Layout

Edit `src/renderer/index.html` and adjust flex properties in `styles.css`:

```css
.panel-editor {
  flex: 1;              /* Editor takes remaining space */
  min-width: 500px;
}

.panel-debug {
  width: 400px;         /* Fixed width for debugger */
}
```

### Adding UI Components

1. Add HTML structure to `index.html`
2. Add styles to `styles.css`
3. Add JavaScript logic to `app.js`

## Implementing File Operations

### Load Script from File

In `src/main/main.js`:

```javascript
const { dialog } = require('electron');

ipcMain.handle('load-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Bitcoin Script', extensions: ['bscript', 'txt'] }
    ]
  });

  if (!result.canceled) {
    const fs = require('fs');
    const content = fs.readFileSync(result.filePaths[0], 'utf8');
    return { success: true, content };
  }

  return { success: false };
});
```

In `src/renderer/app.js`:

```javascript
async function loadFile() {
  const result = await window.electronAPI.loadFile();
  if (result.success) {
    editor.setValue(result.content);
    logToConsole('File loaded successfully', 'success');
  }
}
```

### Save Script to File

Similar pattern using `dialog.showSaveDialog`.

## Adding Breakpoints

### 1. Store Breakpoints

In `src/renderer/interpreter.js`:

```javascript
constructor() {
  this.breakpoints = new Set();  // Already present
}

addBreakpoint(lineNumber) {
  this.breakpoints.add(lineNumber);
}

removeBreakpoint(lineNumber) {
  this.breakpoints.delete(lineNumber);
}
```

### 2. Check During Execution

```javascript
step() {
  if (this.breakpoints.has(this.ip)) {
    // Pause execution
    return false;
  }
  // ... rest of step logic
}
```

### 3. UI for Breakpoints

Add click handlers to editor gutter in `app.js`:

```javascript
editor.onMouseDown((e) => {
  if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
    const lineNumber = e.target.position.lineNumber;
    toggleBreakpoint(lineNumber);
  }
});
```

## Monaco Editor Customization

### Adding Code Completion

In `src/renderer/syntax.js`:

```javascript
monaco.languages.registerCompletionItemProvider('bitcoinscript', {
  provideCompletionItems: (model, position) => {
    const suggestions = [
      {
        label: 'dup',
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: 'dup',
        documentation: 'Duplicate the top stack item'
      },
      // ... more suggestions
    ];
    return { suggestions };
  }
});
```

### Custom Themes

In `src/renderer/syntax.js`, modify `bitcoinScriptTheme`:

```javascript
const bitcoinScriptTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'FF6B9D', fontStyle: 'bold' },
    // ... customize colors
  ],
  colors: {
    'editor.background': '#1a1a1a',
    // ... more color customization
  }
};
```

## Testing

### Manual Testing Checklist

- [ ] Run script executes completely
- [ ] Step mode works correctly
- [ ] Stack visualization updates
- [ ] Execution history shows correctly
- [ ] Error handling works
- [ ] Console output is accurate
- [ ] Keyboard shortcuts work
- [ ] UI is responsive

### Example Test Scripts

Create test scripts in `examples/tests/`:

```javascript
// test-arithmetic.bscript
5 10 add
15 equalVerify  // Should pass

// test-stack.bscript
1 2 3
depth
3 equalVerify  // Should pass
```

## Performance Optimization

### Large Scripts

For scripts with many instructions:

1. Virtualize execution history display
2. Limit stack visualization to top N items
3. Add execution speed control

### Memory Management

Monitor memory in DevTools:
```bash
npm run dev  # Opens with DevTools
```

Check Performance tab for memory leaks.

## Building for Distribution

### macOS

```bash
npm install --save-dev electron-builder

# Add to package.json:
{
  "build": {
    "appId": "com.svscript.app",
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": ["dmg"]
    }
  }
}

# Build
npm run build
```

### Windows

```json
{
  "build": {
    "win": {
      "target": ["nsis"]
    }
  }
}
```

### Linux

```json
{
  "build": {
    "linux": {
      "target": ["AppImage", "deb"]
    }
  }
}
```

## Security Best Practices

### Current Security Implementation

- ✅ Context isolation enabled
- ✅ Node integration disabled
- ✅ Sandbox enabled
- ✅ Preload script with contextBridge
- ✅ Content Security Policy (CSP)

### When Adding Features

1. Never disable security features
2. Use IPC for file operations (not direct Node.js)
3. Validate all user input
4. Don't use `eval()` on user scripts (interpreter handles this safely)
5. Keep dependencies updated

## Debugging

### Renderer Process

```bash
npm run dev  # Opens DevTools automatically
```

Use Chrome DevTools:
- Console for errors
- Sources for breakpoints
- Performance for profiling
- Application for storage inspection

### Main Process

Add to `src/main/main.js`:

```javascript
if (process.argv.includes('--inspect')) {
  require('electron').app.commandLine.appendSwitch('inspect', '5858');
}
```

Run with:
```bash
npm start -- --inspect
```

Connect Chrome DevTools to `chrome://inspect`.

## Common Issues

### Monaco Editor Not Loading

- Check CDN availability
- Verify `require.config` path is correct
- Check browser console for errors

### Stack Not Updating

- Verify `updateStackDisplay()` is called after operations
- Check interpreter state in console
- Ensure UI update methods are being called

### Opcodes Not Highlighting

- Check opcode name matches exactly (case-sensitive)
- Verify it's in `syntax.js` keywords array
- Clear browser cache and reload

## Contributing Guidelines

1. Follow existing code style
2. Add comments for complex logic
3. Update documentation when adding features
4. Test thoroughly before committing
5. Keep security best practices in mind

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/docs.html)
- [Bitcoin Script Reference](https://en.bitcoin.it/wiki/Script)
- [BSV Wiki](https://wiki.bitcoinsv.io/)

## Future Enhancements

Potential features to add:

- [ ] File load/save dialogs
- [ ] Breakpoint support
- [ ] Variable watch expressions
- [ ] Script library/snippets
- [ ] Export execution trace
- [ ] Graphical stack visualization
- [ ] Transaction context simulation
- [ ] P2PKH/P2SH template generation
- [ ] Script optimization suggestions
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcut customization
- [ ] Multi-tab editor
- [ ] Git integration
- [ ] Plugin system

## License

MIT - See LICENSE file for details.
