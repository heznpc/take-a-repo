const fs = require('fs');
const path = require('path');
const { digest } = require('./evidence-contract');

// Hash names AND bytes, including new/untracked files in declared input trees.
// Do not follow symlinks outside the consumer or silently omit missing inputs.
function fingerprintInputs(root, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('evidence.inputs must be a nonempty array');
  root = fs.realpathSync(root);
  const files = [];
  function visit(relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('input path must be relative and contained');
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`input symlink is unsupported: ${relative}`);
    if (stat.isDirectory()) {
      files.push([relative.replaceAll(path.sep, '/'), 'directory']);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
    } else if (stat.isFile()) files.push([relative.replaceAll(path.sep, '/'), digest(fs.readFileSync(file))]);
    else throw new Error(`unsupported input: ${relative}`);
  }
  for (const input of [...new Set(inputs)].sort()) visit(input);
  return { inputs, digest: digest(JSON.stringify(files)), files };
}

module.exports = { fingerprintInputs };
