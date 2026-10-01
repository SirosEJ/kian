import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../../scripts/verify-release-candidate.sh', import.meta.url));
const SHA = 'a'.repeat(40);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-'));
  // Stand-ins: git answers "is ancestor" from FAKE_ON_MAIN, gh answers the number of successful staging runs from FAKE_STAGING_RUNS and records the query.
  writeFileSync(join(dir, 'git'), '#!/usr/bin/env bash\n[ "$1 $2" = "merge-base --is-ancestor" ] || exit 99\n[ "${FAKE_ON_MAIN:-no}" = yes ]\n');
  writeFileSync(join(dir, 'gh'), '#!/usr/bin/env bash\necho "gh $*" >> "$FAKE_GH_LOG"\necho "${FAKE_STAGING_RUNS:-0}"\n');
  chmodSync(join(dir, 'git'), 0o755); chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(join(dir, 'gh.log'), '');
});

async function gate(sha: string, env: Record<string, string> = {}) {
  const full = { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_GH_LOG: join(dir, 'gh.log'), ...env };
  try { const { stdout, stderr } = await run('bash', [script, sha], { env: full }); return { code: 0, out: stdout + stderr }; }
  catch (error) { const e = error as { code: number; stdout: string; stderr: string }; return { code: e.code, out: e.stdout + e.stderr }; }
}

describe('production release gate', () => {
  it('rejects anything that is not a full commit SHA before asking git or GitHub', async () => {
    for (const sha of ['', 'main', 'abc123', 'A'.repeat(40), `${SHA}; rm -rf /`, 'a'.repeat(39)]) expect((await gate(sha, { FAKE_ON_MAIN: 'yes', FAKE_STAGING_RUNS: '1' })).code, sha).toBe(2);
  });

  it('refuses a commit that is not on main, even if staging somehow ran it', async () => {
    const result = await gate(SHA, { FAKE_ON_MAIN: 'no', FAKE_STAGING_RUNS: '1' });
    expect(result.code).toBe(3);
    expect(result.out).toContain('not on main');
  });

  it('refuses a main commit whose own staging deploy did not succeed', async () => {
    const result = await gate(SHA, { FAKE_ON_MAIN: 'yes', FAKE_STAGING_RUNS: '0' });
    expect(result.code).toBe(4);
    expect(result.out).toContain('No successful Deploy Staging run');
  });

  it('allows a main commit that passed staging, and asked about exactly that commit', async () => {
    const result = await gate(SHA, { FAKE_ON_MAIN: 'yes', FAKE_STAGING_RUNS: '1' });
    expect(result.code).toBe(0);
    expect(readFileSync(join(dir, 'gh.log'), 'utf8')).toContain(`--workflow staging.yml --commit ${SHA} --status success`);
  });
});

describe('production workflow', () => {
  const text = readFileSync(fileURLToPath(new URL('../../../../.github/workflows/production.yml', import.meta.url)), 'utf8');
  const triggers = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));

  it('can only be started by hand, never by a push or pull request', () => {
    expect(triggers).toContain('workflow_dispatch');
    expect(triggers).not.toMatch(/\b(push|pull_request|schedule|workflow_run)\b/);
  });

  it('deploys only after the gate and the full test suite, in the approval-protected production environment', () => {
    const deploy = text.slice(text.indexOf('  deploy-production:'));
    expect(deploy).toContain('needs: [verify, test]');
    expect(deploy).toContain('environment: production');
    expect(text).toContain('scripts/verify-release-candidate.sh');
    for (const check of ['pnpm test', 'pnpm test:e2e', 'pnpm typecheck', 'pnpm build']) expect(text.slice(text.indexOf('  test:'), text.indexOf('  deploy-production:'))).toContain(check);
  });

  it('builds the exact commit that was verified, never the branch tip', () => {
    expect((text.match(/ref: \$\{\{ inputs\.sha \}\}/g) ?? []).length).toBe(3);
    expect(text).not.toMatch(/ref: (main|\$\{\{ github\.ref)/);
  });

  it('keeps production data and secrets apart from staging and out of the logs', () => {
    expect(text).toContain('kian-prod-database-url');
    expect(text).toContain('kian-prod-encryption-key');
    expect(text).not.toMatch(/kian-staging|NEON_|DATABASE_URL=\$\{\{/);
    expect(text).not.toMatch(/--set-env-vars="[^"]*DATABASE_URL/);
    expect(text).not.toMatch(/echo[^\n]*(secrets\.|ENCRYPTION|DATABASE_URL=)/);
    expect(text).toContain('--min-instances=1');
    expect(text).toContain('--no-cpu-throttling');
    expect(text).toContain('PUBLIC_URL: https://kian.sepenta.io/');
  });

  it('does not put the typed commit into a shell command line directly', () => {
    expect(text).not.toMatch(/run:[^\n]*\$\{\{ inputs\.sha \}\}/);
    // Every use of the input is a plain value (ref: or an environment variable), which the shell sees as data.
    for (const line of text.split('\n').filter(l => l.includes('${{ inputs.sha }}'))) expect(line.trim(), line).toMatch(/^(ref|RELEASE_SHA): \$\{\{ inputs\.sha \}\}$/);
  });
});
