const fs = require('fs');
const path = require('path');

function readProjectInfo(cwd) {
  const packagePath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packagePath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return {
      name: pkg.name,
      version: pkg.version,
      private: pkg.private,
    };
  } catch (_e) {
    return {};
  }
}

function rel(cwd, filePath) {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}

function ext(filePath) {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

function stableIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
}

function assetRecord({
  cwd,
  outDir,
  filePath,
  name,
  type,
  role,
  width,
  height,
  source,
  target,
  channel,
  media,
  visual,
}) {
  const assetName = name || path.basename(filePath, path.extname(filePath));
  return {
    id: `${stableIdPart(role)}:${stableIdPart(assetName)}`,
    name: assetName,
    type,
    role,
    format: ext(filePath),
    path: rel(cwd, filePath),
    outPath: rel(outDir, filePath),
    width,
    height,
    target,
    channel,
    media,
    visual,
    source,
  };
}

module.exports = {
  assetRecord,
  readProjectInfo,
  rel,
};
