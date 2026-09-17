const fs = require('fs');
const path = require('path');
const { captureEvidence, resolveClaims } = require('./evidence-runner');
const { runProducer } = require('./evidence-producer');
const { fingerprintInputs, fingerprintEnvironment } = require('./evidence-inputs');
const { evidenceState } = require('./evidence-state');
const { digest, validateEvidenceConfig } = require('./evidence-contract');
const { sha256File, writeJson, readJsonIfExists } = require('./handoff-files');
const { PROJECT_FILE, readProject, newProject, saveProject, projectReference, applyProject, editProject, withProjectLock } = require('./production-project');
const { validateEditorial, renderProductionDeliverable } = require('./production-render');
const { stableJson, engineFingerprints, artifactsIntact, reusableDelivery, reusableRun, previousRun, inputState, buildState, producerKey, reusableProducer, renderKey, copyArtifacts, reuseProducer } = require('./production-cache');

function prepare(config, opts = {}) {
  validateEvidenceConfig(config);
  const cwd = path.resolve(opts.cwd || process.cwd());
  const outDir = path.resolve(cwd, config.outDir || 'product-evidence');
  const project = readProject(outDir) || newProject();
  const effective = applyProject(config, project);
  for (const spec of effective.evidence.deliverables) if (spec.kind === 'video') validateEditorial(spec);
  const { render: engine, ...collectors } = engineFingerprints();
  const inputs = inputState(effective, cwd, collectors);
  const fonts = [...new Set(effective.evidence.deliverables.flatMap((d) => (d.captionOptions?.typography?.fonts || []).map((f) => f.from)))];
  const renderInputs = fonts.length ? fingerprintInputs(cwd, fonts) : null;
  const previous = previousRun(outDir);
  let build = null;
  try { build = buildState(effective, cwd); } catch (_error) { /* a fresh build may create missing outputs */ }
  const reuseBuild = !!(effective.build && inputs.buildKey && inputs.producers.every((p) => p.key)
    && previous?.report.production?.buildKey === inputs.buildKey
    && previous.report.build?.exitCode === 0 && build && previous.report.buildFingerprint?.digest === build);
  const producers = effective.evidence.producers.map((p, i) => {
    const key = producerKey(inputs.producers[i], build, config.build);
    const reuse = (!config.build || reuseBuild) && reusableProducer(previous, p, inputs.producers[i], key);
    return { id: p.id, action: reuse ? 'reuse' : 'execute', reason: reuse ? 'local inputs, original capture age and artifact hashes match' : inputs.producers[i].reason || 'capture inputs, build, age or artifacts changed', key };
  });
  const intentDigest = digest(stableJson({ claims: effective.evidence.claims, deliverables: effective.evidence.deliverables, renderInputs: renderInputs?.digest }));
  const projectHash = fs.existsSync(path.join(outDir, PROJECT_FILE)) ? sha256File(path.join(outDir, PROJECT_FILE)) : null;
  const current = readJsonIfExists(path.join(outDir, 'take-a-repo-evidence.json'));
  const marker = readJsonIfExists(path.join(outDir, '.take-a-repo-run.json'));
  const sameCandidate = !!(previous && current?.state === 'completed' && marker?.status === 'completed'
    && current.id === previous.report.id && previous.report.machineStatus === 'publish-ready'
    && previous.report.production?.engine === engine && artifactsIntact(previous, previous.report.files)
    && producers.every((p) => p.action === 'reuse')
    && previous.report.production?.intentDigest === intentDigest
    && previous.report.production?.project.sha256 === projectHash);
  return { cwd, outDir, project, effective, engine, collectors, inputs, renderInputs, previous, build, reuseBuild, producers, intentDigest, sameCandidate };
}

function publicPlan(prepared, { fresh = false } = {}) {
  const { effective, previous, producers } = prepared;
  const allReused = producers.every((p) => p.action === 'reuse');
  return {
    project: { id: prepared.project.id, revision: prepared.project.revision, path: path.join(prepared.outDir, PROJECT_FILE) },
    previousRunId: previous?.report.id || null,
    build: effective.build ? !fresh && prepared.reuseBuild ? 'reuse' : 'execute' : 'not-configured',
    producers: producers.map(({ key: _key, ...p }) => fresh ? { ...p, action: 'execute', reason: 'fresh run requested' } : p),
    deliverables: effective.evidence.deliverables.map((spec) => {
      const prior = previous?.report.deliverables.find((d) => d.id === spec.id && d.status === 'rendered');
      const sourceReusable = spec.kind === 'proof' ? allReused : producers.find((p) => p.id === spec.source.split(':')[0])?.action === 'reuse';
      const sameRecipe = reusableDelivery(previous, prior) && prior.reuseKey === renderKey(spec,
        { ...previous.report, claims: resolveClaims(effective.evidence, previous.report.producers) }, prepared.engine, prepared.renderInputs?.digest);
      return { id: spec.id, action: !fresh && (prepared.sameCandidate || spec.kind === 'video' && sourceReusable && sameRecipe) ? 'reuse' : 'render' };
    }),
    unchanged: !fresh && prepared.sameCandidate,
    modelCalls: 0,
  };
}

function planProduction(config, opts = {}) { return publicPlan(prepare(config, opts), opts); }

async function runProduction(config, opts = {}) {
  validateEvidenceConfig(config);
  const cwd = path.resolve(opts.cwd || process.cwd());
  const outDir = path.resolve(cwd, config.outDir || 'product-evidence');
  return withProjectLock(outDir, async (projectToken) => {
    // Legacy captures and production edits share the candidate directory.
    if (fs.existsSync(path.join(outDir, '.take-a-repo.lock'))) throw new Error('capture output is locked');
    if (!readProject(outDir)) saveProject(outDir, newProject());
    const p = prepare(config, opts);
    const plan = publicPlan(p, opts);
    if (p.sameCandidate && !opts.fresh) {
      let state;
      try { state = evidenceState(outDir); } catch (_error) { /* repair a stale pointer with a new candidate */ }
      if (state?.id === p.previous.report.id && state.problems?.length === 0 && state.machineStatus === 'publish-ready') return {
        outDir, manifest: p.previous.manifest, produced: [], status: state.status, machineStatus: state.machineStatus,
        exitCode: 0, reusedCandidate: true, plan, metrics: { modelCalls: 0, executedProducers: 0, reusedProducers: p.producers.length, renderedDeliverables: 0, reusedDeliverables: p.effective.evidence.deliverables.length },
      };
    }
    const reference = projectReference(outDir, p.project);
    const metrics = { modelCalls: 0, executedProducers: 0, reusedProducers: 0, renderedDeliverables: 0, reusedDeliverables: 0 };
    const record = { version: 1, project: reference, engine: p.engine, buildKey: p.inputs.buildKey, intentDigest: p.intentDigest, metrics };
    if (p.renderInputs) record.renderFreshness = { root: path.relative(outDir, cwd), ...p.renderInputs };
    const production = {
      record,
      projectToken,
      reusedBuild: !opts.fresh && p.reuseBuild ? { ...p.previous.report.build, mode: 'reused', reusedFrom: p.previous.report.id } : null,
      async collect(producer, context, report) {
        const input = p.inputs.producers.find((item) => item.id === producer.id);
        const key = producerKey(input, report.buildFingerprint?.digest || null, config.build);
        let result;
        if (!opts.fresh && (!config.build || p.reuseBuild) && reusableProducer(p.previous, producer, input, key)) {
          result = reuseProducer(p.previous, context.runDir, producer);
          metrics.reusedProducers++;
          context.log(`reuse ${producer.id} from ${result.origin.runId}`);
        } else {
          result = await runProducer(producer, context);
          result.origin = { runId: report.id, source: report.source, finishedAt: result.finishedAt };
          metrics.executedProducers++;
        }
        result.reuseKey = key;
        if (producer.reuse) result.freshness = {
          root: path.relative(outDir, cwd), ...fingerprintInputs(cwd, producer.reuse.inputs),
          environment: fingerprintEnvironment(producer.reuse.environment || []),
        };
        return result;
      },
      async render(spec, report, runDir) {
        const key = renderKey(spec, report, p.engine, p.renderInputs?.digest);
        const old = p.previous?.report.deliverables.find((d) => d.id === spec.id && d.status === 'rendered' && d.reuseKey === key);
        if (!opts.fresh && spec.kind === 'video' && reusableDelivery(p.previous, old)) {
          const files = old.files.map((file) => p.previous.report.files.find((asset) => asset.path === file));
          if (files.some((file) => !file)) throw new Error('cached deliverable file set is incomplete');
          copyArtifacts(p.previous, runDir, files);
          metrics.reusedDeliverables++;
          return { files, reuseKey: key, reusedFrom: p.previous.report.id };
        }
        metrics.renderedDeliverables++;
        return { files: await renderProductionDeliverable(spec, report, runDir, cwd), reuseKey: key };
      },
      verify() {
        if (sha256File(path.join(outDir, PROJECT_FILE)) !== reference.sha256) throw new Error('production project changed during execution');
        if (inputState(p.effective, cwd, p.collectors).digest !== p.inputs.digest) throw new Error('production inputs changed during execution');
        if (p.renderInputs && fingerprintInputs(cwd, p.renderInputs.inputs).digest !== p.renderInputs.digest) throw new Error('caption fonts changed during rendering');
        record.captureVerified = true;
      },
    };
    const result = await captureEvidence(p.effective, { cwd, json: opts.json, log: opts.log, attempt: opts.attempt, production });
    if (reusableRun(readJsonIfExists(result.manifest))) {
      writeJson(path.join(outDir, 'take-a-repo-production-cache.json'), readJsonIfExists(path.join(outDir, 'take-a-repo-evidence.json')));
    }
    return { ...result, reusedCandidate: false, plan, metrics };
  });
}

async function editProduction(config, patch, opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const outDir = path.resolve(cwd, config.outDir || 'product-evidence');
  validateEvidenceConfig(config);
  return withProjectLock(outDir, async () => {
    if (fs.existsSync(path.join(outDir, '.take-a-repo.lock'))) throw new Error('capture output is locked');
    return editProject(config, outDir, patch);
  });
}

module.exports = { planProduction, runProduction, editProduction };
