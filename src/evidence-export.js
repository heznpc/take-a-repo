const fs = require('fs');
const path = require('path');
const { evidenceState } = require('./evidence-state');
const { sha256File, writeJson } = require('./handoff-files');

function destinationPath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((p) => ['..', '.'].includes(p))) throw new Error('export path must be relative and contained');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('export path escapes root');
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('export symlinks are unsupported');
  }
  return target;
}

// Consumer owns destination mapping; the engine owns approval + byte verification.
function exportApprovedEvidence({ outDir, root, mappings, receipt = 'capture-assets.json' }) {
  root = fs.realpathSync(root);
  const state = evidenceState(outDir);
  if (!state.publishable) throw new Error(`current evidence requires user approval: ${state.status}`);
  const receiptPath = destinationPath(root, receipt);
  const targets = new Set([receiptPath]);
  const files = mappings.map(({ asset, destination }) => {
    const source = state.report.files.find((f) => `${f.producer || 'deliverable'}:${f.id}` === asset);
    if (!source) throw new Error(`unknown export asset: ${asset}`);
    const target = destinationPath(root, destination);
    if (targets.has(target)) throw new Error('duplicate export destination');
    targets.add(target);
    const bytes = fs.readFileSync(path.join(state.runDir, source.path));
    const expected = source.sha256;
    if (require('./evidence-contract').digest(bytes) !== expected) throw new Error('source changed before export');
    return { asset, destination, sha256: expected, target, bytes };
  });
  if (!files.length) throw new Error('export requires mappings');
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  // Invalidate a former export before changing any destination. Receipt is last.
  writeJson(receiptPath, { status: 'writing', runId: state.id });
  for (const file of files) {
    fs.mkdirSync(path.dirname(file.target), { recursive: true });
    fs.writeFileSync(file.target, file.bytes);
    if (sha256File(file.target) !== file.sha256) throw new Error('export integrity mismatch');
  }
  const result = { version: 1, status: 'approved', runId: state.id, reviewDigest: state.reviewDigest, files: files.map(({ asset, destination, sha256 }) => ({ asset, destination, sha256 })) };
  writeJson(receiptPath, result);
  return result;
}

function verifyExportedEvidence({ root, receipt = 'capture-assets.json' }) {
  root = fs.realpathSync(root);
  const result = JSON.parse(fs.readFileSync(destinationPath(root, receipt), 'utf8'));
  if (result.status !== 'approved' || !result.reviewDigest || !result.files?.length) throw new Error('no completed approved export');
  for (const file of result.files) {
    if (sha256File(destinationPath(root, file.destination)) !== file.sha256) throw new Error(`export changed: ${file.destination}`);
  }
  return result;
}

module.exports = { exportApprovedEvidence, verifyExportedEvidence };
