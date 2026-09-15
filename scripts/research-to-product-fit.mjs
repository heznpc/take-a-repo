#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const templateRoot = path.join(repoRoot, 'skills', 'research-to-product-fit', 'templates');
const defaultOutRoot = path.join(repoRoot, 'research-runs');

function usage() {
  return `Usage:
  npm run research -- --topic "take-a-repo demo video quality automation" [--dry-run]

Options:
  --topic <text>       Required research topic.
  --target <path>      Target repo path. Defaults to this repo.
  --out-dir <path>     Output root. Defaults to research-runs/.
  --date <YYYY-MM-DD>  Override run date.
  --dry-run            Print the run plan without writing files.
  --help               Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    target: repoRoot,
    outDir: defaultOutRoot,
    dryRun: false,
  };
  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--topic') {
      args.topic = readValue(i, arg);
      i += 1;
    } else if (arg === '--target') {
      args.target = path.resolve(readValue(i, arg));
      i += 1;
    } else if (arg === '--out-dir') {
      args.outDir = path.resolve(readValue(i, arg));
      i += 1;
    } else if (arg === '--date') {
      args.date = readValue(i, arg);
      i += 1;
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && (!args.topic || !args.topic.trim())) {
    throw new Error('Missing required --topic');
  }
  if (args.date) validateDate(args.date);
  return args;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--date must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('--date must be a real calendar date');
  }
}

function todayKst() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '');
  return slug || 'research-topic';
}

function uniqueRunDir(outDir, baseName) {
  let candidate = path.join(outDir, baseName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outDir, `${baseName}-${index}`);
    index += 1;
  }
  return candidate;
}

function displayPath(filePath) {
  const relative = path.relative(repoRoot, filePath);
  if (!relative) return '.';
  return relative.startsWith('..') || path.isAbsolute(relative) ? filePath : relative;
}

function readTemplate(name) {
  return fs.readFileSync(path.join(templateRoot, name), 'utf8');
}

function fillResearchLedger(template, meta) {
  return template
    .replace(/^Topic:\s*$/m, `Topic: ${meta.topic}`)
    .replace(/^Date:\s*$/m, `Date: ${meta.date}`)
    .replace(/^Scout:\s*$/m, 'Scout: Claude')
    .replace(/^Target repo:\s*$/m, `Target repo: ${meta.target}`)
    .replace(/^- Repo:\s*$/m, `- Repo: ${meta.target}`)
    .replace(/^- Git status checked:\s*$/m, '- Git status checked: pending')
    .replace(/^- Local files checked:\s*$/m, '- Local files checked: pending')
    .replace(/^- Read-only reference repos checked:\s*$/m, '- Read-only reference repos checked: pending')
    .replace(/^- Out of scope:\s*$/m, '- Out of scope: implementation, publish, and unrelated repo edits');
}

function fillProjectFitMatrix(template, meta) {
  return template
    .replace(/^Topic:\s*$/m, `Topic: ${meta.topic}`)
    .replace(/^Date:\s*$/m, `Date: ${meta.date}`)
    .replace(/^Target repo:\s*$/m, `Target repo: ${meta.target}`)
    .replace(/^- Package\/scripts:\s*$/m, '- Package/scripts: pending')
    .replace(/^- Tests:\s*$/m, '- Tests: pending')
    .replace(/^- README\/docs:\s*$/m, '- README/docs: pending')
    .replace(/^- Existing project constraints:\s*$/m, '- Existing project constraints: pending')
    .replace(/^- Read-only references:\s*$/m, '- Read-only references: pending');
}

function checklist() {
  return `## Omission Prevention Checklist

- [ ] README or landing page checked.
- [ ] package/config/install surface checked.
- [ ] docs/examples checked.
- [ ] tests/validation story checked.
- [ ] release/issues/activity signal checked.
- [ ] License/security/privacy/store-compliance risk checked.
- [ ] Local project constraints mapped before TODOs.
- [ ] Rejected candidates recorded with revisit trigger.
`;
}

function runReadme(meta) {
  return `# Research Run: ${meta.topic}

- Date: ${meta.date}
- Target repo: \`${meta.target}\`
- Run directory: \`${meta.relativeRunDir}\`
- Status: scaffolded

## How To Use

The harness separates roles, not vendors.

Default flow: Claude for scout/critic, Codex for repo integration.

Gemini is optional, not assumed. Use Gemini only if you want a second broad search pass.

1. Paste \`01-scout.prompt.md\` into Claude and save the result into \`research-ledger.md\`.
2. Paste \`02-critic.prompt.md\` into a separate Claude session or Codex with the filled ledger, then save critique notes back into \`research-ledger.md\` or \`project-fit-matrix.md\`.
3. Paste \`03-integrator.prompt.md\` into Codex after scout and critic outputs exist.
4. Use \`next-implementation.prompt.md\` only after the fit matrix has a single smallest useful TODO.

## Files

- \`research-ledger.md\` - source inventory and candidate evidence.
- \`project-fit-matrix.md\` - local constraints mapped to adopt/adapt/reject decisions.
- \`01-scout.prompt.md\` - broad source scouting.
- \`02-critic.prompt.md\` - skeptical evidence and scope critique.
- \`03-integrator.prompt.md\` - local repo integration plan.
- \`next-implementation.prompt.md\` - one-task implementation handoff.

${checklist()}`;
}

function scoutPrompt(meta) {
  return `# Scout Prompt

You are the scout for a research-to-product-fit run.

Topic: ${meta.topic}
Target repo: ${meta.target}

Default runner: Claude.
Optional secondary runner: Gemini, only if you want a second broad search pass.

Your job is to broaden source coverage, not decide implementation.

Fill or update \`research-ledger.md\` with:

- Candidate tools/repos/docs/articles.
- Source URLs or local file paths.
- Evidence status for each required check.
- Missing checks and risk if skipped.
- Rejected candidates and revisit triggers.

Required omission checks for every serious candidate:

- README or landing page.
- package/config/install surface.
- docs/examples.
- tests/validation story.
- release/issues/activity signal.

Rules:

- Mark unchecked evidence as \`unchecked\`; do not imply it was read.
- Prefer primary sources.
- Keep rejected candidates in the ledger.
- Do not propose code changes.
- Do not touch files directly unless the user explicitly asks you to.
`;
}

function criticPrompt(meta) {
  return `# Critic Prompt

You are the critic for a research-to-product-fit run.

Topic: ${meta.topic}
Target repo: ${meta.target}

Inputs:

- \`research-ledger.md\`
- \`project-fit-matrix.md\` if present
- Local repo files relevant to the topic

Default runner: a separate Claude session, or Codex if Claude is not available.

Take a skeptical release-manager stance.

Review for:

- Unsupported source claims.
- Missing README/landing, package/config, docs/examples, tests/validation, or release/activity checks.
- License, security, privacy, store-compliance, hosted-service, or maintenance risk.
- Ideas that would turn a small pilot into a broad product.
- TODOs that are too large, irreversible, or not testable.

Output:

- Blockers first.
- Missing checks table.
- Adopt/adapt/reject corrections.
- Scope cuts.
- A recommendation for the smallest reviewable next slice.

Do not implement code.
`;
}

function integratorPrompt(meta) {
  return `# Integrator Prompt

You are the integrator for a research-to-product-fit run.

Topic: ${meta.topic}
Target repo: ${meta.target}

Inputs:

- Filled \`research-ledger.md\`
- Claude critique notes
- Current local repo state

Your job:

1. Re-check local repo files before trusting the ledger.
2. Fill \`project-fit-matrix.md\` with local constraints and source evidence.
3. Convert only well-supported patterns into small TODOs.
4. Pick at most one smallest useful next implementation task.
5. Write or update \`next-implementation.prompt.md\`.

Guardrails:

- Do not implement the feature during integration.
- Do not publish, push, or create new sessions.
- Keep read-only reference repos read-only.
- Separate research harness/docs from product implementation.
`;
}

function nextImplementationPrompt(meta) {
  return `# Next Implementation Prompt

Topic: ${meta.topic}
Target repo: ${meta.target}

Use this only after \`research-ledger.md\` and \`project-fit-matrix.md\` are filled.

Before coding:

- Read the decision log in \`project-fit-matrix.md\`.
- Confirm the selected TODO is the smallest useful unit.
- Confirm the stop condition and non-goals.
- Confirm validation commands.

Implementation handoff template:

1. Selected TODO:
2. Target files:
3. Source evidence:
4. Local evidence:
5. Acceptance checks:
6. Stop condition:
7. Explicit non-goals:

Do not broaden scope while implementing.
`;
}

function filesForRun(meta) {
  return {
    'README.md': runReadme(meta),
    'research-ledger.md': `${fillResearchLedger(readTemplate('research-ledger.md'), meta)}\n${checklist()}`,
    'project-fit-matrix.md': `${fillProjectFitMatrix(readTemplate('project-fit-matrix.md'), meta)}\n${checklist()}`,
    '01-scout.prompt.md': scoutPrompt(meta),
    '02-critic.prompt.md': criticPrompt(meta),
    '03-integrator.prompt.md': integratorPrompt(meta),
    'next-implementation.prompt.md': nextImplementationPrompt(meta),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const date = args.date || todayKst();
  const slug = slugify(args.topic);
  const runDir = uniqueRunDir(args.outDir, `${date}-${slug}`);
  const meta = {
    topic: args.topic.trim(),
    date,
    slug,
    target: args.target,
    runDir,
    relativeRunDir: displayPath(runDir),
  };
  const files = filesForRun(meta);
  const fileNames = Object.keys(files);

  if (args.dryRun) {
    console.log(`research-to-product-fit dry run`);
    console.log(`topic: ${meta.topic}`);
    console.log(`runDir: ${meta.relativeRunDir}`);
    for (const name of fileNames) console.log(`would create: ${name}`);
    return;
  }

  fs.mkdirSync(runDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(runDir, name), content.endsWith('\n') ? content : `${content}\n`);
  }

  console.log(`created research run: ${meta.relativeRunDir}`);
  for (const name of fileNames) console.log(`created: ${name}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error('');
  console.error(usage());
  process.exit(1);
}
