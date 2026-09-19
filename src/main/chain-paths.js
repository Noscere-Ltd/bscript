// Where a chain project is allowed to point.
//
// A .bsm.json names its contract file, and the project may have been
// downloaded. Without a check, "contract": "../../.ssh/id_rsa" loads that file
// into the editor, and the next AI chat sends it out. A project may only name
// a .bscript file inside its own directory.

const path = require('path');

// Returns the resolved path, or throws naming the path it refused.
function resolveProjectFile(projectDir, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('The chain project does not name a contract file');
  }

  const dir = path.resolve(projectDir);
  const resolved = path.resolve(dir, relativePath);

  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error('Refusing to read outside the project directory: ' + relativePath);
  }
  if (path.extname(resolved) !== '.bscript') {
    throw new Error('A chain project may only name .bscript files: ' + relativePath);
  }
  return resolved;
}

module.exports = { resolveProjectFile };
