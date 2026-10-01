import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../../../scripts/cleanup-story-preview.sh', import.meta.url));

type Branch = { id: string; name: string; default?: boolean };
let server: Server, port: number, requests: string[], branches: Branch[], listStatus: number, dir: string;

beforeEach(async () => {
  requests = []; branches = []; listStatus = 200;
  dir = mkdtempSync(join(tmpdir(), 'cleanup-'));
  // A stand-in for the gcloud command: lists the services named in FAKE_SERVICES and logs every delete.
  writeFileSync(join(dir, 'gcloud'), `#!/usr/bin/env bash
echo "gcloud $*" >> "$FAKE_GCLOUD_LOG"
case "$*" in
  *"services list"*) for s in \${FAKE_SERVICES//,/ }; do case "$*" in *"metadata.name=$s"*) echo "$s";; esac; done ;;
  *"services delete"*) ;;
esac
`);
  chmodSync(join(dir, 'gcloud'), 0o755);
  writeFileSync(join(dir, 'gcloud.log'), '');
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    request.resume();
    const send = (code: number, body: unknown) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.method === 'GET' && request.url?.includes('/branches')) return listStatus === 200 ? send(200, { branches }) : send(listStatus, { message: 'upstream exploded' });
    if (request.method === 'DELETE') return send(200, { operations: [] });
    send(404, {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});
afterEach(() => new Promise<void>(resolve => server.close(() => resolve())));

async function cleanup(story: string, options: { dryRun?: boolean; services?: string } = {}) {
  const args = [script, story, ...(options.dryRun ? ['--dry-run'] : [])];
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GCP_PROJECT_ID: 'proj', NEON_API_KEY: 'key', NEON_PROJECT_ID: 'neon-proj', NEON_API_BASE: `http://127.0.0.1:${port}/api/v2`, FAKE_GCLOUD_LOG: join(dir, 'gcloud.log'), FAKE_SERVICES: options.services ?? '' };
  try { const { stdout, stderr } = await run('bash', args, { env }); return { code: 0, out: stdout + stderr }; }
  catch (error) { const e = error as { code: number; stdout: string; stderr: string }; return { code: e.code, out: e.stdout + e.stderr }; }
}
const gcloudCalls = () => readFileSync(join(dir, 'gcloud.log'), 'utf8').split('\n').filter(Boolean);
const deletes = () => requests.filter(r => r.startsWith('DELETE'));

describe('story preview cleanup script', () => {
  it('refuses anything that is not a plain story number, before contacting anything', async () => {
    for (const story of ['', 'abc', '12;rm -rf /', '1/../2', 'staging', '-5', '1234567']) {
      const result = await cleanup(story);
      expect(result.code, `story "${story}"`).toBe(2);
    }
    expect(requests).toEqual([]);
    expect(gcloudCalls()).toEqual([]);
  });

  it('only reports in a dry run and deletes nothing', async () => {
    branches = [{ id: 'br-5', name: 'kian-sft-5' }];
    const result = await cleanup('5', { dryRun: true, services: 'kian-sft-5' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('would delete (dry run)');
    expect(deletes()).toEqual([]);
    expect(gcloudCalls().some(call => call.includes('services delete'))).toBe(false);
  });

  it('deletes exactly this story\'s branch and service, not look-alikes or staging', async () => {
    branches = [{ id: 'br-50', name: 'kian-sft-50' }, { id: 'br-5', name: 'kian-sft-5' }, { id: 'br-st', name: 'kian-staging' }, { id: 'br-main', name: 'main', default: true }];
    const result = await cleanup('5', { services: 'kian-sft-5,kian-sft-50,kian-staging' });
    expect(result.code).toBe(0);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]).toContain('/branches/br-5');
    const removed = gcloudCalls().filter(call => call.includes('services delete'));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('services delete kian-sft-5 ');
    expect(result.out).toContain('Neon branch kian-sft-5 (br-5): deleted');
    expect(result.out).toContain('Cloud Run service kian-sft-5: deleted');
  });

  it('succeeds when everything is already gone, so a second run is harmless', async () => {
    const result = await cleanup('9');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Neon branch kian-sft-9: already gone');
    expect(result.out).toContain('Cloud Run service kian-sft-9: already gone');
    expect(deletes()).toEqual([]);
  });

  it('refuses to delete a branch that Neon reports as the default branch', async () => {
    branches = [{ id: 'br-def', name: 'kian-sft-7', default: true }];
    const result = await cleanup('7', { services: 'kian-sft-7' });
    expect(result.code).toBe(3);
    expect(result.out).toContain('default branch');
    expect(deletes()).toEqual([]);
    expect(gcloudCalls().some(call => call.includes('services delete'))).toBe(false);
  });

  it('fails visibly with the provider message on a real error, without deleting anything', async () => {
    listStatus = 500;
    const result = await cleanup('5', { services: 'kian-sft-5' });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('upstream exploded');
    expect(deletes()).toEqual([]);
    expect(gcloudCalls().some(call => call.includes('services delete'))).toBe(false);
  });
});
