const fs = require('fs');
const path = require('path');
const { resolveConfigPath } = require('./cli');
const { planProduction, runProduction, editProduction } = require('./production');
const { readProject } = require('./production-project');
const { evidenceState } = require('./evidence-state');
const { observeProduction, productionContext } = require('./production-observe');

const PRODUCTION_USAGE = `take-a-repo production <plan|run|observe|context|edit|status> [repo] [options]

  plan                explain which producers and outputs will be reused
  run                 create/update the saved project and complete candidate
  observe             index source video frames once; reuse intact observations
  context             return bounded frame references and current edit state
  edit --patch <json>  apply trim/caption changes against baseRevision
  status              inspect the saved project and current candidate

  --config <path>      consumer config (default: take-a-repo.config.js)
  --fresh             run: force a fresh build, capture and render
  --attempt <n>       run: positive retry number for automation.maxAttempts
  --source <id:asset>  observe/context: configured source video
  --from <seconds>    context: inclusive source time (default: 0)
  --to <seconds>      context: exclusive source time (default: duration)
  --max-frames <n>    context: 2..32 images (default: 8)
  --json              exactly one JSON result; progress goes to stderr

Reuse is opt-in per producer: reuse: { mode: 'local-inputs', inputs: [...],
maxAgeSeconds: 86400, environment: [...] }. Declare all local dependencies;
live services and undeclared inputs must not be cached. Existing evidence and
user approval remain bound to their original run. No model or uploader is used.

Edit example:
{"baseRevision":1,"operations":[{"deliverable":"demo-x","set":{"captions":[
  {"id":"intro","start":0,"end":4,"text":"Your product in action"}
]}}]}

Caption times are relative to the edited output; captions use a measured band
below the product. An edit cannot change sources, claims, checks or approvals.
`;

async function runProductionCommand(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const json = argv.includes('--json');
  const output = (value) => stdout.write(`${JSON.stringify(value, null, json ? 0 : 2)}\n`);
  if (argv.includes('--help') || argv.includes('-h')) { stdout.write(PRODUCTION_USAGE); return 0; }
  let code = 2;
  try {
    const args = argv.slice(1);
    const action = args.shift();
    if (!['plan', 'run', 'observe', 'context', 'edit', 'status'].includes(action)) throw new Error('expected production plan, run, observe, context, edit or status');
    const options = { json };
    let repo = null;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--json') continue;
      if (arg === '--fresh') { options.fresh = true; continue; }
      if (['--config', '--patch', '--attempt', '--source', '--from', '--to', '--max-frames'].includes(arg)) {
        const value = args[++i];
        if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
        options[arg.slice(2)] = value;
      } else if (arg.startsWith('-') || repo !== null) throw new Error(`unexpected argument: ${arg}`);
      else repo = arg;
    }
    if (options.fresh && action !== 'run') throw new Error('--fresh is only supported by production run');
    if (options.source !== undefined && !['observe', 'context'].includes(action)) throw new Error('--source requires production observe or context');
    for (const key of ['from', 'to', 'max-frames']) {
      if (options[key] === undefined) continue;
      if (action !== 'context' || !Number.isFinite(Number(options[key]))) throw new Error(`--${key} requires a number and production context`);
      options[key] = Number(options[key]);
    }
    if (options.from < 0 || options.to <= 0 || options.from !== undefined && options.to !== undefined && options.to <= options.from
      || options['max-frames'] !== undefined && (!Number.isInteger(options['max-frames']) || options['max-frames'] < 2 || options['max-frames'] > 32)) throw new Error('invalid context range or frame budget');
    if (options.attempt !== undefined) {
      options.attempt = Number(options.attempt);
      if (action !== 'run' || !Number.isSafeInteger(options.attempt) || options.attempt < 1) throw new Error('--attempt requires a positive integer and production run');
    }
    if (action === 'edit' && !options.patch || action !== 'edit' && options.patch) throw new Error('production edit requires --patch; other actions do not accept it');
    const invocationCwd = (io.processCwd || (() => process.cwd()))();
    const cwd = path.resolve(invocationCwd, repo || '.');
    const configPath = resolveConfigPath(options.config, cwd);
    if (!configPath || !fs.existsSync(configPath)) throw new Error('production requires a take-a-repo.config.js with evidence producers');
    code = 1;
    const loaded = require(configPath);
    const config = loaded.default || loaded;
    const opts = { cwd, json, fresh: options.fresh, attempt: options.attempt, source: options.source, from: options.from, to: options.to, maxFrames: options['max-frames'], log: (message) => stderr.write(`[take-a-repo] ${message}\n`) };
    if (action === 'plan') output({ ok: true, ...planProduction(config, opts) });
    else if (action === 'observe') output({ ok: true, ...await observeProduction(config, opts) });
    else if (action === 'context') output({ ok: true, ...productionContext(config, opts) });
    else if (action === 'edit') {
      const patchPath = path.resolve(invocationCwd, options.patch);
      if (fs.statSync(patchPath).size > 256 * 1024) throw new Error('edit patch exceeds 256 KiB');
      const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
      const project = await editProduction(config, patch, opts);
      output({ ok: true, status: 'edited', project: { id: project.id, revision: project.revision }, next: 'Run production run to render the new candidate.' });
    } else if (action === 'status') {
      const outDir = path.resolve(cwd, config.outDir || 'product-evidence');
      const state = evidenceState(outDir);
      output({ ok: true, project: readProject(outDir), candidate: { id: state.id, status: state.status, publishable: state.publishable, problems: state.problems, metrics: state.report?.production?.metrics } });
    } else {
      const result = await runProduction(config, opts);
      // Keep routine agent context bounded. Detailed recipes/files remain in
      // the saved project, plan command and referenced run report.
      const { outDir, manifest, status, machineStatus, exitCode, reusedCandidate, metrics } = result;
      output({ ok: exitCode === 0, outDir, manifest, status, machineStatus, exitCode, reusedCandidate, metrics });
      return result.exitCode;
    }
    return 0;
  } catch (error) {
    if (json) output({ ok: false, code, error: error.message });
    else stderr.write(`[take-a-repo] ${error.message}\n`);
    return code;
  }
}

module.exports = { runProductionCommand, PRODUCTION_USAGE };
