const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'research-to-product-fit.mjs');

function runResearch(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('research-to-product-fit CLI', () => {
  test('accepts a real override date', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-a-repo-research-test-'));
    const result = runResearch([
      '--topic',
      'date validation smoke',
      '--out-dir',
      outDir,
      '--date',
      '2026-02-28',
      '--dry-run',
    ]);
    fs.rmSync(outDir, { recursive: true, force: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2026-02-28-date-validation-smoke');
  });

  test('uses role-based prompt filenames in dry run output', () => {
    const result = runResearch([
      '--topic',
      'role filename smoke',
      '--date',
      '2026-02-28',
      '--dry-run',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('would create: 01-scout.prompt.md');
    expect(result.stdout).toContain('would create: 02-critic.prompt.md');
    expect(result.stdout).toContain('would create: 03-integrator.prompt.md');
    expect(result.stdout).not.toContain('gemini');
    expect(result.stdout).not.toContain('claude');
    expect(result.stdout).not.toContain('codex');
  });

  test('rejects impossible override dates', () => {
    const result = runResearch([
      '--topic',
      'date validation smoke',
      '--date',
      '2026-99-99',
      '--dry-run',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--date must be a real calendar date');
  });

  test('rejects a flag where a date value is required', () => {
    const result = runResearch([
      '--topic',
      'date validation smoke',
      '--date',
      '--dry-run',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--date needs a value');
  });
});
