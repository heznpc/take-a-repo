const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Ajv = require('ajv');
const { digest, validateEvidenceConfig } = require('./evidence-contract');
const { writeJson, sha256File } = require('./handoff-files');
const { validateEditorial } = require('./production-render');

const PROJECT_FILE = 'take-a-repo-project.json';
const validate = new Ajv({ allErrors: true }).compile(require('../schemas/production-project.schema.json'));

function validateProject(project) {
  if (!validate(project)) throw new Error(`invalid production project: ${validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
  return project;
}

function readProject(outDir) {
  const file = path.join(outDir, PROJECT_FILE);
  return fs.existsSync(file) ? validateProject(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
}

function newProject() {
  const now = new Date().toISOString();
  return { version: 1, kind: 'take-a-repo.production-project', id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now, edits: {} };
}

function saveProject(outDir, project) {
  validateProject(project);
  const history = path.join(outDir, 'project-history', project.id);
  fs.mkdirSync(history, { recursive: true });
  // History is append-only. The current pointer is replaced only after the
  // complete revision exists, so an interrupted edit cannot corrupt history.
  fs.writeFileSync(path.join(history, `${project.revision}.json`), `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx' });
  writeJson(path.join(outDir, PROJECT_FILE), project);
  return project;
}

function projectReference(outDir, project) {
  return { path: PROJECT_FILE, id: project.id, revision: project.revision, sha256: sha256File(path.join(outDir, PROJECT_FILE)) };
}

function applyProject(config, project) {
  validateEvidenceConfig(config);
  validateProject(project);
  const videos = new Set(config.evidence.deliverables.filter((d) => d.kind === 'video').map((d) => d.id));
  for (const id of Object.keys(project.edits)) if (!videos.has(id)) throw new Error(`project edit references missing video ${id}; reconcile the project before running`);
  return {
    ...config,
    evidence: {
      ...config.evidence,
      deliverables: config.evidence.deliverables.map((d) => ({ ...d, ...project.edits[d.id] })),
    },
  };
}

function editProject(config, outDir, patch) {
  const previous = readProject(outDir);
  if (!previous) throw new Error('no production project; run production run first');
  if (!patch || Object.keys(patch).some((k) => !['baseRevision', 'operations'].includes(k))
    || patch.baseRevision !== previous.revision) throw new Error('project revision conflict; read the current project and rebase the edit');
  if (!Array.isArray(patch.operations) || !patch.operations.length || patch.operations.length > 100) throw new Error('edit requires 1..100 operations');
  const project = JSON.parse(JSON.stringify(previous));
  for (const op of patch.operations) {
    if (!op || Object.keys(op).some((k) => !['deliverable', 'set', 'reset'].includes(k))) throw new Error('invalid edit operation');
    if (!config.evidence.deliverables.some((d) => d.kind === 'video' && d.id === op.deliverable)) throw new Error('edit requires a configured video deliverable');
    if ((op.reset === true) === (op.set != null)) throw new Error('choose set or reset for each edit');
    if (op.reset === true) delete project.edits[op.deliverable];
    else {
      if (!op.set || typeof op.set !== 'object' || Array.isArray(op.set) || !Object.keys(op.set).length
        || Object.keys(op.set).some((k) => !['trim', 'captions'].includes(k))) throw new Error('only trim and captions can be edited; sources, claims, checks and authority are protected');
      project.edits[op.deliverable] = { ...project.edits[op.deliverable], ...op.set };
    }
  }
  const effective = applyProject(config, project);
  for (const spec of effective.evidence.deliverables) if (spec.kind === 'video') validateEditorial(spec);
  if (digest(JSON.stringify(previous.edits)) === digest(JSON.stringify(project.edits))) return previous;
  project.revision++;
  project.updatedAt = new Date().toISOString();
  return saveProject(outDir, project);
}

async function withProjectLock(outDir, action) {
  fs.mkdirSync(outDir, { recursive: true });
  const lock = path.join(outDir, '.take-a-repo-project.lock');
  const token = crypto.randomUUID();
  try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('production project is locked; check the owning process', { cause: error });
    throw error;
  }
  try { return await action(token); } finally { fs.unlinkSync(lock); }
}

module.exports = { PROJECT_FILE, readProject, newProject, saveProject, projectReference, applyProject, editProject, withProjectLock };
