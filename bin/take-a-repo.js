#!/usr/bin/env node
/*
 * take-a-repo CLI — thin wrapper over capture().
 *
 *   take-a-repo [path] [--config <path>] [--scene <name>]... [--json|--calibrate]
 *           [--no-video] [--no-build] [--live-gt] [--freeze]
 *   take-a-repo demo <url|dir|file.html> [--out <dir>] [--duration <s>] [--json]
 *
 * `path` (optional positional) is the repo to run against (default: cwd) —
 * lets an agent invoke take-a-repo against any checkout without cd'ing first.
 * Config resolution: --config, else take-a-repo.config.js inside that directory.
 *
 * Exit codes: 0 ok · 1 runtime failure · 2 usage / no config found.
 * With --json, stdout carries exactly one JSON object and progress logs go
 * to stderr, so agents can parse stdout blindly.
 */

const { runCli } = require('../src/cli-runner');

async function main() {
  process.exitCode = await runCli(process.argv.slice(2));
}

main().catch((err) => {
  if (process.argv.includes('--json')) {
    const msg = err && err.message ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: msg, code: 1 }) + '\n');
  } else {
    console.error('[take-a-repo] FAILED:', err && err.stack ? err.stack : err);
  }
  process.exit(1);
});
